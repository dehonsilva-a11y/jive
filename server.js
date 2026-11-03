import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

const gemini_key = process.env.GEMINI_KEY || "";
const ai = new GoogleGenAI({ apiKey: gemini_key });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const bancoDeConversas = new Map();
const cacheAnalisesIA = new Map();
let gotoTokenCache = { token: null, expiraEm: 0, refreshToken: null };

const HEADERS_API = {
    'Accept': 'application/json',
    'User-Agent': 'GoTo-Webhook-Client/1.0'
};

// Lê do data/goto_config.json caso não esteja configurado na Vercel
function obterCredenciais() {
    let local = {};
    const caminhoConfig = path.join(process.cwd(), 'data', 'goto_config.json');
    if (fs.existsSync(caminhoConfig)) {
        try { local = JSON.parse(fs.readFileSync(caminhoConfig, 'utf-8')); } catch (e) {}
    }

    return {
        clientId: process.env.GOTO_CLIENT_ID || local.client_id,
        clientSecret: process.env.GOTO_CLIENT_SECRET || local.client_secret,
        refreshToken: gotoTokenCache.refreshToken || process.env.GOTO_REFRESH_TOKEN || local.refresh_token
    };
}

// ==========================================
// ROTA AUTOMÁTICA: TROCAR CODE POR REFRESH_TOKEN
// ==========================================
app.get('/api/gerar-token', async (req, res) => {
    try {
        const code = req.query.code;
        if (!code) {
            return res.status(400).send("Falta o parametro ?code= na URL.");
        }

        const { clientId, clientSecret } = obterCredenciais();
        const redirectUri = "http://localhost:3000/callback";
        const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        const resposta = await fetch('https://authentication.logmeininc.com/oauth/token', {
            method: 'POST',
            headers: {
                ...HEADERS_API,
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: code.trim(),
                redirect_uri: redirectUri
            })
        });

        const texto = await resposta.text();
        let dados;
        try { dados = JSON.parse(texto); } catch (e) { dados = texto; }

        if (!resposta.ok) {
            return res.status(resposta.status).json({
                sucesso: false,
                mensagem: "A GoTo rejeitou o code.",
                detalhe: dados
            });
        }

        res.json({
            sucesso: true,
            mensagem: "Copie o refresh_token abaixo e cole na linha 5 do seu goto_config.json:",
            refresh_token: dados.refresh_token,
            access_token: dados.access_token
        });
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// ==========================================
// AUTENTICAÇÃO OAUTH 2.0
// ==========================================
async function obterTokenGoTo() {
    const agora = Date.now();
    if (gotoTokenCache.token && agora < gotoTokenCache.expiraEm - 60000) {
        return gotoTokenCache.token;
    }

    const { clientId, clientSecret, refreshToken } = obterCredenciais();

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error("Credenciais GoTo ausentes (verifique variáveis de ambiente ou goto_config.json).");
    }

    const credenciaisBase64 = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const resposta = await fetch('https://authentication.logmeininc.com/oauth/token', {
        method: 'POST',
        headers: {
            ...HEADERS_API,
            'Authorization': `Basic ${credenciaisBase64}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken })
    });

    if (!resposta.ok) throw new Error(`Falha na autenticacao GoTo: ${await resposta.text()}`);

    const dados = await resposta.json();
    gotoTokenCache.token = dados.access_token;
    gotoTokenCache.expiraEm = agora + (dados.expires_in * 1000);
    if (dados.refresh_token) gotoTokenCache.refreshToken = dados.refresh_token;

    return gotoTokenCache.token;
}

// ==========================================
// CONSULTA DE TEMPLATES & CANAIS DE MENSAGENS
// ==========================================
app.get('/api/check-templates', async (req, res) => {
    const resultados = [];
    try {
        const token = await obterTokenGoTo();
        const accountKeys = ["5363286181559338501", "4055072950408524550"];

        const rotasParaTestar = [
            'https://api.goto.com/messaging/v2/templates',
            'https://api.goto.com/messaging/v2/channels',
            'https://api.goto.com/messaging/v1/channels'
        ];

        for (const ak of accountKeys) {
            rotasParaTestar.push(`https://api.goto.com/messaging/v2/templates?accountKey=${ak}`);
            rotasParaTestar.push(`https://api.goto.com/messaging/v2/accounts/${ak}/templates`);
            rotasParaTestar.push(`https://api.goto.com/messaging/v1/channels?accountKey=${ak}`);
        }

        for (const url of rotasParaTestar) {
            try {
                const resp = await fetch(url, {
                    method: 'GET',
                    headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}` }
                });

                const texto = await resp.text();
                let dadosJson = null;
                try { dadosJson = JSON.parse(texto); } catch (e) { dadosJson = texto; }

                resultados.push({
                    urlConsultada: url,
                    status: resp.status,
                    autorizado: resp.ok,
                    resposta: dadosJson
                });
            } catch (err) {
                resultados.push({ urlConsultada: url, erro: err.message });
            }
        }

        res.json({
            sucesso: true,
            escopos_token: ["messaging.v1.send", "messaging.v1.write", "messaging.v1.read"],
            testes: resultados
        });

    } catch (erro) {
        res.status(500).json({ sucesso: false, erro: erro.message });
    }
});

app.post('/webhook', (req, res) => res.status(200).json({ sucesso: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

export default app;