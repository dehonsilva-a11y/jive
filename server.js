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

const PADRAO_CLIENT_ID = "3253a422-73e1-4585-af2e-590f6111d494";
const PADRAO_CLIENT_SECRET = "pBn8JYvMPlJz7mk9XgIuHO3p";
const PADRAO_CHANNEL_ID = "49889407-3cc9-47b1-b33d-afa97956e162";
const PADRAO_REFRESH_TOKEN = "eyJraWQiOiI2MjAiLCJhbGciOiJSUzUxMiJ9.eyJzYyI6ImNhbGwtY29udHJvbC52MS5jYWxscy5jb250cm9sIGFzc2V0LnYxLm5vdGlmaWNhdGlvbnMubWFuYWdlIGNhbGxzLnYyLmluaXRpYXRlIG1lc3NhZ2luZy52MS53cml0ZSBpZGVudGl0eTpzY2ltLm1lIGNhbGwtZXZlbnRzLnYxLmV2ZW50cy5yZWFkIGNjLWFuYWx5dGljcy52MS5hZ2VudC1zdGF0dXMucmVhZCB1c2Vycy52MS5yZWFkIG1lc3NhZ2luZy52MS5ub3RpZmljYXRpb25zLm1hbmFnZSB2b2ljZW1haWwudjEubm90aWZpY2F0aW9ucy5tYW5hZ2UgY2FsbC1wYXJraW5nLnYxLm5vdGlmaWNhdGlvbnMubWFuYWdlIHZvaWNlbWFpbC52MS52b2ljZW1haWxzLndyaXRlIHN1cHBvcnQ6IHJlY29yZGluZy52MS5ub3RpZmljYXRpb25zLm1hbmFnZSBmYXgudjEud3JpdGUgdm9pY2UtYWRtaW4udjEud3JpdGUgd2VicnRjLnYxLndyaXRlIHdlYnJ0Yy52MS5yZWFkIGlkZW50aXR5OiBjb2xsYWI6IHF1ZXVlLWNhbGxlci52MS5yZWFkIHZvaWNlLWFkbWluLnYxLnJlYWQgcHJlc2VuY2UudjEucmVhZCBjb250YWN0cy52MS5yZWFkIHJlY29yZGluZy52MS5yZWFkIGNhbGwtZXZlbnRzLnYxLm5vdGlmaWNhdGlvbnMubWFuYWdlIGlkZW50aXR5OnNjaW0ub3JnIHByZXNlbmNlLnYxLndyaXRlIGZheC52MS5yZWFkIGNvbnRhY3RzLnYxLndyaXRlIGNhbGwtaGlzdG9yeS52MS5ub3RpZmljYXRpb25zLm1hbmFnZSBwcmVzZW5jZS52MS5ub3RpZmljYXRpb25zLm1hbmFnZSBtZXNzYWdpbmcudjEuc2VuZCBjYWxsLXBhcmtpbmcudjEucmVhZCBtZXNzYWdpbmcudjEucmVhZCBjci52MS5yZWFkIGZheC52MS5ub3RpZmljYXRpb25zLm1hbmFnZSB1c2Vycy52MS5saW5lcy5yZWFkIHZvaWNlbWFpbC52MS52b2ljZW1haWxzLnJlYWQiLCJzdWIiOiIyMjgyNDI0OTE2MDUzMDAzMDIwIiwiYXVkIjoiMzI1M2E0MjItNzNlMS00NTg1LWFmMmUtNTkwZjYxMTFkNDk0Iiwib2duIjoicHdkIiwidHlwIjoiciIsImxldmVsT2ZBc3N1cmFuY2UiOjIsImV4cCI6MTc5NjMzMTkzOCwiaWF0IjoxNzkzNzM5OTM4LCJqdGkiOiIyNTZjY2NiZC0zMTU3LTQ4YzItOTgwOC0zNGQ4YzYyYmZhN2YifQ.m6ztojoArZN69JzCJNFAeG-C7FSWOazUHGpzfImusBXmg3efOFhLHh473H9JnWhlv4Oj3tE7ugqi_fEnzVhIVmaW1YhdVOU0Ja5o49fmxAtB919k2hvL1i1Ce9W2h-39Hh7KLkzcKHmLefKskZiEMvEFfyMSxAVQ7oQhsDXhSBFFW4jbXtnBRwbmwW3fWD01-E6-TmgfMiWio-wcOOJH-fliOTOaU2EsaqXzZ4ucxc1Ib5ucFKaJR9YaVnxf4KGI72gQ6kSpWwKboIHQWI3ltvMCgNNvdj_pnORk0xK737GNwattOYF716gVMOZxzlPfiEa0NysodEBxkvHZTcaXUw";

function ehRefreshTokenValido(tok) {
    if (!tok || typeof tok !== 'string') return false;
    try {
        const partes = tok.split('.');
        if (partes.length !== 3) return false;
        const payload = JSON.parse(Buffer.from(partes[1], 'base64').toString('utf-8'));
        return payload.typ === 'r';
    } catch (e) {
        return false;
    }
}

function obterCredenciais(req = null) {
    let local = {};
    const caminhos = [
        path.join(process.cwd(), 'data', 'goto_config.json'),
        path.join(__dirname, 'data', 'goto_config.json')
    ];

    for (const p of caminhos) {
        if (fs.existsSync(p)) {
            try { 
                local = JSON.parse(fs.readFileSync(p, 'utf-8')); 
                break;
            } catch (e) {}
        }
    }

    const querySecret = req?.query?.secret || req?.query?.client_secret;
    const queryClientId = req?.query?.client_id;

    const clientId = (queryClientId || process.env.GOTO_CLIENT_ID || local.client_id || PADRAO_CLIENT_ID).trim();
    const clientSecret = (querySecret || process.env.GOTO_CLIENT_SECRET || local.client_secret || PADRAO_CLIENT_SECRET).trim();
    const channelId = (req?.query?.channelId || local.channel_id || PADRAO_CHANNEL_ID).trim();

    let refreshToken = PADRAO_REFRESH_TOKEN;
    const candidatos = [
        gotoTokenCache.refreshToken,
        process.env.GOTO_REFRESH_TOKEN,
        local.refresh_token
    ];

    for (const c of candidatos) {
        if (ehRefreshTokenValido(c)) {
            refreshToken = c.trim();
            break;
        }
    }

    return { clientId, clientSecret, refreshToken, channelId };
}

async function obterTokenGoTo() {
    const agora = Date.now();
    if (gotoTokenCache.token && agora < gotoTokenCache.expiraEm - 60000) {
        return gotoTokenCache.token;
    }

    const { clientId, clientSecret, refreshToken } = obterCredenciais();
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
// CONSULTA OFICIAL COM OWNER TOUCHPOINT & DESCOBERTA DE CANAIS
// ==========================================
app.get('/api/check-templates', async (req, res) => {
    const resultados = [];
    try {
        const token = await obterTokenGoTo();
        const { channelId } = obterCredenciais(req);
        const touchpointParam = req.query.ownerTouchpoint || channelId;

        // 1. Identificar o usuário e a conta oficial pelo endpoint /users/v1/me
        let contaIdentificada = null;
        try {
            const respMe = await fetch('https://api.goto.com/users/v1/me', {
                headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}` }
            });
            if (respMe.ok) {
                contaIdentificada = await respMe.json();
            }
        } catch (e) {}

        const accountKeys = [
            contaIdentificada?.accountKey,
            "5363286181559338501",
            "4055072950408524550"
        ].filter(Boolean);

        const accountKeysUnicas = [...new Set(accountKeys)];

        // 2. Montar as rotas passando o ownerTouchpoint obrigatório e rotas de descoberta de canais
        const rotasParaTestar = [];

        for (const ak of accountKeysUnicas) {
            // Chamada oficial do Step 1 com ownerTouchpoint
            rotasParaTestar.push({ tipo: 'Templates (ownerTouchpoint)', ak, url: `https://api.goto.com/messaging/v2/accounts/${ak}/message-templates?ownerTouchpoint=${touchpointParam}` });
            
            // Rotas de listagem para descobrir IDs numéricos de touchpoints cadastrados
            rotasParaTestar.push({ tipo: 'Descoberta Touchpoints', ak, url: `https://api.goto.com/messaging/v2/accounts/${ak}/touchpoints` });
            rotasParaTestar.push({ tipo: 'Descoberta Channels', ak, url: `https://api.goto.com/messaging/v2/accounts/${ak}/channels` });
        }

        for (const item of rotasParaTestar) {
            try {
                const resp = await fetch(item.url, {
                    method: 'GET',
                    headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}` }
                });

                const texto = await resp.text();
                let dadosJson = null;
                try { dadosJson = JSON.parse(texto); } catch (e) { dadosJson = texto; }

                resultados.push({
                    finalidade: item.tipo,
                    accountKey: item.ak,
                    urlConsultada: item.url,
                    status: resp.status,
                    autorizado: resp.ok,
                    resposta: dadosJson
                });
            } catch (err) {
                resultados.push({
                    finalidade: item.tipo,
                    accountKey: item.ak,
                    urlConsultada: item.url,
                    erro: err.message
                });
            }
        }

        res.json({
            sucesso: true,
            usuario_me: contaIdentificada ? { nome: contaIdentificada.name, email: contaIdentificada.email, accountKey: contaIdentificada.accountKey } : "Nao retornado",
            ownerTouchpoint_testado: touchpointParam,
            testes: resultados
        });

    } catch (erro) {
        res.status(500).json({ sucesso: false, erro: erro.message });
    }
});

// ==========================================
// DISPARO DE MENSAGENS WHATSAPP
// ==========================================
app.post('/api/enviar-mensagem', async (req, res) => {
    try {
        const token = await obterTokenGoTo();
        const { accountKey = "5363286181559338501", fromPhoneId, to, texto, templateName, templateParams = {} } = req.body;

        if (!to) {
            return res.status(400).json({ erro: "Destinatario 'to' obrigatorio em formato E.164 (ex: +5511999999999)" });
        }

        let requestObj = {
            channel: "WHATSAPP",
            from: fromPhoneId,
            to: Array.isArray(to) ? to : [to]
        };

        if (templateName) {
            requestObj.type = "template";
            requestObj.template = {
                name: templateName,
                ...templateParams
            };
        } else {
            requestObj.type = "simple";
            requestObj.components = [
                {
                    type: "body",
                    components: [
                        {
                            type: "text",
                            attributes: { text: texto || "Olá! Como podemos ajudar?" }
                        }
                    ]
                }
            ];
        }

        const formData = new FormData();
        const blobRequest = new Blob([JSON.stringify(requestObj)], { type: 'application/json' });
        formData.append('request', blobRequest);

        const resp = await fetch(`https://api.goto.com/messaging/v2/accounts/${accountKey}/messages`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        const textoResp = await resp.text();
        let dadosJson;
        try { dadosJson = JSON.parse(textoResp); } catch (e) { dadosJson = textoResp; }

        res.status(resp.status).json({
            sucesso: resp.ok,
            status: resp.status,
            resposta: dadosJson
        });

    } catch (e) {
        res.status(500).json({ sucesso: false, erro: e.message });
    }
});

app.post('/webhook', (req, res) => res.status(200).json({ sucesso: true }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

export default app;