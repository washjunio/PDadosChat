const OpenAI = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX = process.env.PINECONE_INDEX;
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || undefined;
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const CHAT_PASSWORD = process.env.CHAT_PASSWORD || '120996';

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });

function assertVectorConfig() {
  const missing = [];
  if (!OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
  if (!PINECONE_API_KEY) missing.push('PINECONE_API_KEY');
  if (!PINECONE_INDEX) missing.push('PINECONE_INDEX');
  return missing.length ? `Variáveis de ambiente ausentes: ${missing.join(', ')}` : null;
}

async function embedBatch(texts) {
  const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
  return response.data.map((d) => d.embedding);
}

function buildContextFromMetadata(md) {
  const lines = [];
  if (md.titulo) lines.push(`Título: ${md.titulo}`);
  if (md.problema) lines.push(`Problema: ${md.problema}`);
  if (md.solucao) lines.push(`Solução: ${md.solucao}`);
  if (md.menuSistema) lines.push(`Menu do Sistema: ${md.menuSistema}`);
  if (md.nomeCli) lines.push(`Cliente: ${md.nomeCli}`);
  if (md.nomeFuncionarioCliente) lines.push(`Funcionário do Cliente: ${md.nomeFuncionarioCliente}`);
  if (md.respAbertura) lines.push(`Atendente: ${md.respAbertura}`);
  if (md.Comentario) lines.push(`Comentário: ${md.Comentario}`);
  if (md.Tags) lines.push(`Tags: ${md.Tags}`);
  return lines.join('\n');
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const cfgErr = assertVectorConfig();
  if (cfgErr) return res.status(500).json({ error: 'Configuração inválida', details: cfgErr });

  try {
    const provided = req.headers['x-chat-password'] || req.body?.password;
    if ((provided ?? '') !== CHAT_PASSWORD) {
      return res.status(401).json({ error: 'Não autorizado' });
    }

    const question = (req.body && req.body.question) ? String(req.body.question) : '';
    const topK = Math.max(1, Math.min(30, Number(req.body?.topK || 20)));
    if (!question) return res.status(400).json({ error: 'Campo "question" é obrigatório' });

    const [qEmbedding] = await embedBatch([question]);

    let idx = pinecone.index(PINECONE_INDEX);
    if (PINECONE_NAMESPACE) idx = idx.namespace(PINECONE_NAMESPACE);
    const queryRes = await idx.query({
      vector: qEmbedding,
      topK,
      includeMetadata: true
    });

    const matches = (queryRes.matches || []).map(m => ({
      id: m.id,
      score: m.score,
      metadata: m.metadata || {}
    }));

    const contextBlocks = matches.map((m, i) => `# Resultado ${i + 1} (score: ${Number(m.score).toFixed(3)})\n${buildContextFromMetadata(m.metadata)}`);
    let context = contextBlocks.join('\n\n');
    if (context.length > 8000) context = context.slice(0, 8000);

    const systemPrompt = [
      'Você é um assistente de suporte técnico de um ERP chamado Pro-Dados Plus. Responda em português de forma objetiva e prática.',
      'Use apenas as informações do CONTEXTO fornecido. Se o contexto não ajudar, admita e sugira passos de diagnóstico.',
      'Se houver passos de comando (ex.: plusinstall), descreva-os com cuidado.',
    ].join(' ');

    const userPrompt = `Pergunta do usuário:\n${question}\n\nCONTEXTO (resultados do banco vetorial):\n${context}`;

    const completion = await openai.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    });

    const answer = completion.choices?.[0]?.message?.content || '';

    return res.status(200).json({ ok: true, answer, matches });
  } catch (err) {
    console.error('[api/chat] Erro:', err);
    return res.status(500).json({ error: 'Falha ao processar chat', details: err.message });
  }
};


