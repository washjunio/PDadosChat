# Conversor JSON para Excel

Um projeto Node.js que converte dados JSON em planilhas Excel (.xlsx).

## 🚀 Funcionalidades

- **Interface Web Amigável**: Interface moderna e responsiva para upload de dados
- **Suporte a JSON Direto**: Cole seus dados JSON diretamente na interface
- **Upload de Arquivo**: Faça upload de arquivos JSON
- **Drag & Drop**: Arraste e solte arquivos JSON
- **Download Automático**: O arquivo Excel é baixado automaticamente após a conversão
- **Validação de Dados**: Verifica se o JSON é válido antes da conversão

## 📋 Pré-requisitos

- Node.js (versão 14 ou superior)
- npm (gerenciador de pacotes do Node.js)

## 🛠️ Instalação

1. Clone ou baixe este projeto
2. Navegue até o diretório do projeto:
   ```bash
   cd json-to-excel
   ```

3. Instale as dependências:
   ```bash
   npm install
   ```

## 🚀 Como Usar

### 1. Iniciar o Servidor

```bash
npm start
```

Ou diretamente com Node.js:

```bash
node server.js
```

### 2. Acessar a Interface

Abra seu navegador e acesse:
```
http://localhost:3000
```

### 3. Converter Dados

#### Opção 1: JSON Direto
1. Clique na aba "JSON Direto"
2. Cole seus dados JSON no campo de texto
3. Clique em "Converter para Excel"
4. O arquivo será baixado automaticamente

#### Opção 2: Arquivo JSON
1. Clique na aba "Arquivo JSON"
2. Clique na área de upload ou arraste um arquivo JSON
3. Clique em "Converter para Excel"
4. O arquivo será baixado automaticamente

## 📊 Estrutura de Dados Suportada

O projeto aceita arrays de objetos JSON. Exemplo da estrutura suportada:

```json
[
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
]
```

## 🔧 API Endpoints

### POST /convert
Converte dados JSON para Excel.

**Parâmetros:**
- `data` (string): JSON como string (opcional se arquivo for enviado)
- `jsonFile` (file): Arquivo JSON (opcional se data for enviado)

**Resposta:**
- Arquivo Excel (.xlsx) para download

### GET /test
Retorna dados de exemplo para teste.

## 📁 Estrutura do Projeto

```
json-to-excel/
├── server.js          # Servidor principal
├── package.json       # Dependências e scripts
├── README.md         # Este arquivo
├── public/           # Arquivos estáticos
│   └── index.html    # Interface web
└── downloads/        # Diretório temporário para downloads
```

## 🛠️ Tecnologias Utilizadas

- **Node.js**: Runtime JavaScript
- **Express.js**: Framework web
- **Multer**: Middleware para upload de arquivos
- **XLSX**: Biblioteca para manipulação de arquivos Excel
- **CORS**: Middleware para Cross-Origin Resource Sharing

## 🔧 Scripts Disponíveis

```bash
# Iniciar o servidor
npm start

# Executar em modo de desenvolvimento (se nodemon estiver instalado)
npm run dev
```

## 🐛 Solução de Problemas

### Erro de Permissão
Se você encontrar erros de permissão no npm, execute:
```bash
sudo chown -R $(whoami) ~/.npm
```

### Porta em Uso
Se a porta 3000 estiver em uso, você pode alterar a variável `PORT` no arquivo `server.js` ou definir uma variável de ambiente:
```bash
PORT=3001 node server.js
```

## 📝 Licença

Este projeto é de código aberto e está disponível sob a licença MIT.

## 🤝 Contribuições

Contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou pull requests.
