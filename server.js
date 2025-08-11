require('dotenv').config();
const express = require('express');
const multer = require('multer');
const cors = require('cors');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OpenAI = require('openai');
const { Pinecone } = require('@pinecone-database/pinecone');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '50mb' }));
app.use(express.static('public', { index: false }));

// Logger simples para depuração
app.use((req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} - CT: ${contentType}`);
    next();
});

// Configuração do multer para upload de arquivos
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    // Ajuste este limite conforme necessário para depuração
    limits: { fileSize: 30 * 1024 * 1024 } // 30 MB
});

// -------- Config Embeddings / Pinecone --------
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;
const PINECONE_INDEX = process.env.PINECONE_INDEX;
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || undefined;

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const pinecone = new Pinecone({ apiKey: PINECONE_API_KEY });
const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
const CHAT_PASSWORD = process.env.CHAT_PASSWORD || '120996';
const EMBED_PASSWORD = process.env.EMBED_PASSWORD || '01648728';

function assertVectorConfig() {
    const missing = [];
    if (!OPENAI_API_KEY) missing.push('OPENAI_API_KEY');
    if (!PINECONE_API_KEY) missing.push('PINECONE_API_KEY');
    if (!PINECONE_INDEX) missing.push('PINECONE_INDEX');
    if (missing.length) {
        const msg = `Variáveis de ambiente ausentes: ${missing.join(', ')}`;
        console.error('[embed-config] ' + msg);
        return msg;
    }
    return null;
}

function buildCanonicalText(item) {
    const parts = [];
    const safe = (v) => (v === null || v === undefined ? '' : String(v));
    if (safe(item.titulo)) parts.push(`Título: ${safe(item.titulo)}`);
    if (safe(item.problema)) parts.push(`Problema: ${safe(item.problema)}`);
    if (safe(item.solucao)) parts.push(`Solução: ${safe(item.solucao)}`);
    if (safe(item.menuSistema)) parts.push(`Menu do Sistema: ${safe(item.menuSistema)}`);
    if (safe(item.nomeCli)) parts.push(`Cliente: ${safe(item.nomeCli)}`);
    if (safe(item.nomeFuncionarioCliente)) parts.push(`Funcionário do Cliente: ${safe(item.nomeFuncionarioCliente)}`);
    if (safe(item.respAbertura)) parts.push(`Atendente: ${safe(item.respAbertura)}`);
    if (safe(item.Comentario)) parts.push(`Comentário: ${safe(item.Comentario)}`);
    if (safe(item.Tags)) parts.push(`Tags: ${safe(item.Tags)}`);
    return parts.join('\n');
}

function createDeterministicId(item, index) {
    const base = `${item.nomeCli || ''}|${item.titulo || ''}|${item.problema || ''}|${item.solucao || ''}|${index}`;
    return crypto.createHash('sha256').update(base).digest('hex').slice(0, 32);
}

function sanitizeMetadata(input) {
    const out = {};
    for (const [key, value] of Object.entries(input || {})) {
        if (value === null || value === undefined) continue;
        const t = typeof value;
        if (t === 'string' || t === 'number' || t === 'boolean') {
            out[key] = value;
            continue;
        }
        if (Array.isArray(value)) {
            const allStrings = value.every((v) => typeof v === 'string');
            if (allStrings) {
                out[key] = value;
            } else {
                // ignora arrays com tipos não suportados
            }
            continue;
        }
        // ignora objetos ou outros tipos não suportados
    }
    return out;
}

async function embedBatch(texts) {
    const response = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: texts });
    // response.data é um array na mesma ordem de input
    return response.data.map((d) => d.embedding);
}

async function upsertBatchToPinecone(records) {
    let idx = pinecone.index(PINECONE_INDEX);
    if (PINECONE_NAMESPACE) idx = idx.namespace(PINECONE_NAMESPACE);
    // SDK v2 aceita array direto
    await idx.upsert(records);
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

// Rota principal → Home
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Alias para acessar a home diretamente
app.get('/home', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Página de chat (RAG)
app.get('/chat', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Rota para receber JSON e gerar embeddings no Pinecone
app.post('/embed-json', async (req, res) => {
    console.log('[/embed-json] Início do processamento');
    const cfgErr = assertVectorConfig();
    if (cfgErr) {
        return res.status(500).json({ error: 'Configuração inválida', details: cfgErr });
    }
    // Autenticação simples via senha específica de embed
    const provided = req.headers['x-embed-password'] || req.body?.password;
    if ((provided ?? '') !== EMBED_PASSWORD) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    try {
        const data = req.body;
        if (!Array.isArray(data)) {
            return res.status(400).json({ error: 'O corpo da requisição deve ser um array de objetos' });
        }

        console.log(`[/embed-json] Registros recebidos: ${data.length}`);

        const BATCH_SIZE = 100; // ajuste conforme necessário
        let totalUpserted = 0;

        for (let start = 0; start < data.length; start += BATCH_SIZE) {
            const chunk = data.slice(start, start + BATCH_SIZE);
            const texts = chunk.map(buildCanonicalText);
            const embeddings = await embedBatch(texts);

            const timestamp = new Date().toISOString();
            const records = chunk.map((item, i) => ({
                id: createDeterministicId(item, start + i),
                values: embeddings[i],
                metadata: sanitizeMetadata({
                    respAbertura: item.respAbertura,
                    titulo: item.titulo,
                    problema: item.problema,
                    solucao: item.solucao,
                    menuSistema: item.menuSistema,
                    nomeCli: item.nomeCli,
                    nomeFuncionarioCliente: item.nomeFuncionarioCliente,
                    Comentario: item.Comentario,
                    Tags: item.Tags,
                    createdAt: timestamp,
                    source: 'api:/embed-json'
                })
            }));

            await upsertBatchToPinecone(records);
            totalUpserted += records.length;
            console.log(`[/embed-json] Upsert realizado: +${records.length} (total=${totalUpserted})`);
        }

        return res.json({
            ok: true,
            upserted: totalUpserted,
            index: PINECONE_INDEX,
            namespace: PINECONE_NAMESPACE || null,
            model: EMBEDDING_MODEL
        });
    } catch (err) {
        console.error('[/embed-json] Erro:', err);
        return res.status(500).json({ error: 'Falha ao processar embeddings', details: err.message });
    }
});

// Rota para receber um arquivo Excel e gerar embeddings
app.post('/embed-excel', upload.single('excelFile'), async (req, res) => {
    console.log('[/embed-excel] Início do processamento');
    const cfgErr = assertVectorConfig();
    if (cfgErr) {
        return res.status(500).json({ error: 'Configuração inválida', details: cfgErr });
    }
    const provided = req.headers['x-embed-password'] || req.body?.password;
    if ((provided ?? '') !== EMBED_PASSWORD) {
        return res.status(401).json({ error: 'Não autorizado' });
    }

    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Envie um arquivo Excel no campo "excelFile"' });
        }

        // Lê o Excel da memória e converte a primeira aba em array de objetos
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) {
            return res.status(400).json({ error: 'Arquivo Excel sem planilhas' });
        }
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: null });

        if (!Array.isArray(jsonData) || jsonData.length === 0) {
            return res.status(400).json({ error: 'Não foi possível extrair dados do Excel' });
        }

        console.log(`[/embed-excel] Registros extraídos do Excel: ${jsonData.length}`);

        const BATCH_SIZE = 100;
        let totalUpserted = 0;
        for (let start = 0; start < jsonData.length; start += BATCH_SIZE) {
            const chunk = jsonData.slice(start, start + BATCH_SIZE);
            const texts = chunk.map(buildCanonicalText);
            const embeddings = await embedBatch(texts);
            const timestamp = new Date().toISOString();
            const records = chunk.map((item, i) => ({
                id: createDeterministicId(item, start + i),
                values: embeddings[i],
                metadata: sanitizeMetadata({
                    respAbertura: item.respAbertura,
                    titulo: item.titulo,
                    problema: item.problema,
                    solucao: item.solucao,
                    menuSistema: item.menuSistema,
                    nomeCli: item.nomeCli,
                    nomeFuncionarioCliente: item.nomeFuncionarioCliente,
                    Comentario: item.Comentario,
                    Tags: item.Tags,
                    createdAt: timestamp,
                    source: 'api:/embed-excel'
                })
            }));
            await upsertBatchToPinecone(records);
            totalUpserted += records.length;
            console.log(`[/embed-excel] Upsert realizado: +${records.length} (total=${totalUpserted})`);
        }

        return res.json({
            ok: true,
            upserted: totalUpserted,
            index: PINECONE_INDEX,
            namespace: PINECONE_NAMESPACE || null,
            model: EMBEDDING_MODEL
        });
    } catch (err) {
        console.error('[/embed-excel] Erro:', err);
        return res.status(500).json({ error: 'Falha ao processar embeddings (Excel)', details: err.message });
    }
});

// Rota de chat (local) e alias para compatibilidade com Vercel
const chatHandler = require(path.join(__dirname, 'api', 'chat.js'));
app.post('/chat', chatHandler);
app.post('/api/chat', chatHandler);

// Rota para converter JSON para Excel
app.post('/convert', upload.single('jsonFile'), (req, res) => {
    console.log('[/convert] Início do processamento');
    try {
        let jsonData;

        // Verifica se os dados vieram do body ou do arquivo
        if (req.file) {
            console.log('[/convert] Arquivo recebido:', {
                fieldname: req.file.fieldname,
                originalname: req.file.originalname,
                mimetype: req.file.mimetype,
                size: req.file.size
            });
            try {
                jsonData = JSON.parse(req.file.buffer.toString());
            } catch (parseErr) {
                console.error('[/convert] Erro ao fazer parse do arquivo JSON:', parseErr);
                return res.status(400).json({ error: 'Arquivo JSON inválido', details: parseErr.message });
            }
        } else if (req.body && typeof req.body.data === 'string') {
            console.log('[/convert] Campo data encontrado no body. Tamanho:', req.body.data.length);
            try {
                jsonData = JSON.parse(req.body.data);
            } catch (parseErr) {
                console.error('[/convert] Erro ao fazer parse do JSON do body:', parseErr);
                return res.status(400).json({ error: 'JSON no body inválido', details: parseErr.message });
            }
        } else {
            console.warn('[/convert] Nenhum dado JSON fornecido (arquivo ou body.data ausentes)');
            return res.status(400).json({ 
                error: 'Nenhum dado JSON fornecido. Use o campo "data" no body ou envie um arquivo com o campo "jsonFile".' 
            });
        }

        // Valida se é um array
        if (!Array.isArray(jsonData)) {
            console.warn('[/convert] JSON não é um array de objetos');
            return res.status(400).json({ 
                error: 'Os dados devem ser um array de objetos' 
            });
        }

        // Filtro opcional: somente linhas com campo solucao > N caracteres
        const minLenRaw = req.body?.filterSolutionMinLen;
        const minLen = minLenRaw !== undefined ? Number(minLenRaw) : 0;
        if (!Number.isNaN(minLen) && minLen > 0) {
            const before = jsonData.length;
            jsonData = jsonData.filter((row) => typeof row?.solucao === 'string' && row.solucao.length > minLen);
            console.log(`[/convert] Filtro aplicado (solucao > ${minLen}). ${before} -> ${jsonData.length}`);
        }

        console.log('[/convert] JSON válido. Quantidade de registros:', jsonData.length);

        // Cria uma nova planilha
        const workbook = XLSX.utils.book_new();
        
        // Converte o JSON para uma planilha
        const worksheet = XLSX.utils.json_to_sheet(jsonData);
        
        // Adiciona a planilha ao workbook
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Dados');
        console.log('[/convert] Planilha gerada com sucesso');
        
        // Gera o nome do arquivo com timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `dados_convertidos_${timestamp}.xlsx`;
        const filepath = path.join(__dirname, 'downloads', filename);
        
        // Cria o diretório downloads se não existir
        const downloadsDir = path.join(__dirname, 'downloads');
        if (!fs.existsSync(downloadsDir)) {
            fs.mkdirSync(downloadsDir);
            console.log('[/convert] Diretório downloads criado');
        }
        
        // Escreve o arquivo Excel
        XLSX.writeFile(workbook, filepath);
        console.log('[/convert] Arquivo escrito em disco:', filepath);
        
        // Envia o arquivo como resposta
        res.download(filepath, filename, (err) => {
            if (err) {
                console.error('[/convert] Erro ao enviar arquivo:', err);
                return res.status(500).json({ error: 'Erro ao enviar arquivo', details: err.message });
            }
            console.log('[/convert] Download iniciado pelo cliente. Removendo arquivo temporário...');
            // Remove o arquivo após o download
            fs.unlink(filepath, (unlinkErr) => {
                if (unlinkErr) {
                    console.error('[/convert] Erro ao remover arquivo temporário:', unlinkErr);
                } else {
                    console.log('[/convert] Arquivo temporário removido:', filename);
                }
            });
        });
        
    } catch (error) {
        console.error('[/convert] Erro na conversão:', error);
        res.status(500).json({ 
            error: 'Erro ao processar dados JSON', 
            details: error.message 
        });
    }
});

// Rota para testar com dados de exemplo
app.get('/test', (req, res) => {
    const sampleData = [
        {
            "respAbertura": "Renata Borges",
            "titulo": "Plus nao puxa a loja",
            "problema": "Plus nao puxa a loja ao fazer login",
            "solucao": "disco c estava cheio, wash mexeu e depois deu erro de conexao, executei plusinstall e deu certo",
            "menuSistema": "",
            "nomeCli": "FUFU LEGAL",
            "nomeFuncionarioCliente": "Daniel Machado",
            "Comentario": null
        },
        {
            "respAbertura": "Renata Borges",
            "titulo": "Nota fiscal",
            "problema": "cean invalido",
            "solucao": "corrigido cod de barras no cadastro e nfe foi emitida",
            "menuSistema": "",
            "nomeCli": "TELLURE AGRO",
            "nomeFuncionarioCliente": "Andreia",
            "Comentario": null
        }
    ];
    
    res.json(sampleData);
});

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
});

// Tratador de erros do multer (ex.: arquivo muito grande, campo incorreto)
app.use((err, req, res, next) => {
    if (err && err.name === 'MulterError') {
        console.error('[multer] Erro de upload:', err);
        return res.status(400).json({ error: 'Erro no upload do arquivo', code: err.code, details: err.message });
    }
    return next(err);
});

// Tratador de erros geral
app.use((err, req, res, next) => {
    console.error(`[error] ${req.method} ${req.url}:`, err);
    res.status(500).json({ error: 'Erro interno do servidor', details: err.message });
});
