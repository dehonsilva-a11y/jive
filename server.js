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

    const clientId = (process.env.GOTO_CLIENT_ID || local.client_id || PADRAO_CLIENT_ID).trim();
    const clientSecret = (process.env.GOTO_CLIENT_SECRET || local.client_secret || PADRAO_CLIENT_SECRET).trim();
    const channelId = (local.channel_id || PADRAO_CHANNEL_ID).trim();

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
// DESCOBERTA DE IDENTIDADE, CONTA E TEMPLATES
// ==========================================
app.get('/api/check-templates', async (req, res) => {
    const diagnostico = {
        etapa_1_identidade: null,
        etapa_2_accountKeys_descobertas: [],
        etapa_3_canais_e_touchpoints: [],
        etapa_4_templates: []
    };

    try {
        const token = await obterTokenGoTo();
        const { channelId } = obterCredenciais(req);

        // ETAPA 1: Identificar a conta real do usuário pelo sub oficial (2282424916053003020)
        const urlsIdentidade = [
            'https://api.goto.com/users/v1/users/2282424916053003020',
            'https://api.goto.com/users/v1/me',
            'https://api.goto.com/identity/scim/v2/Me'
        ];

        let dadosUsuario = null;
        for (const url of urlsIdentidade) {
            try {
                const resp = await fetch(url, { headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}` } });
                const texto = await resp.text();
                let json;
                try { json = JSON.parse(texto); } catch (e) { json = texto; }
                if (resp.ok) {
                    dadosUsuario = { url, dados: json };
                    break;
                }
            } catch (e) {}
        }
        diagnostico.etapa_1_identidade = dadosUsuario;

        // ETAPA 2: Extrair todas as chaves de conta candidatas do perfil do usuário
        const accountKeysEncontradas = new Set();
        if (dadosUsuario?.dados) {
            const u = dadosUsuario.dados;
            // Varre campos típicos da GoTo
            const campos = [u.accountKey, u.organizationKey, u.organizationId, u.accountId, u.key, u.organization?.key];
            campos.filter(Boolean).forEach(k => accountKeysEncontradas.add(String(k)));
        }

        // Se a busca automática não achar, mantém os fallbacks conhecidos
        if (accountKeysEncontradas.size === 0) {
            accountKeysEncontradas.add("5363286181559338501");
            accountKeysEncontradas.add("4055072950408524550");
        }
        diagnostico.etapa_2_accountKeys_descobertas = Array.from(accountKeysEncontradas);

        // ETAPA 3: Consultar Canais e Touchpoints em cada accountKey
        const touchpointsDescobertos = new Set([
            "551151992000",
            "+551151992000",
            "1151992000",
            channelId
        ]);

        for (const ak of diagnostico.etapa_2_accountKeys_descobertas) {
            const rotasCanais = [
                `https://api.goto.com/messaging/v2/accounts/${ak}/channels`,
                `https://api.goto.com/messaging/v2/accounts/${ak}/touchpoints`
            ];

            for (const url of rotasCanais) {
                try {
                    const resp = await fetch(url, { headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}` } });
                    const texto = await resp.text();
                    let json;
                    try { json = JSON.parse(texto); } catch (e) { json = texto; }
                    
                    diagnostico.etapa_3_canais_e_touchpoints.push({ url, status: resp.status, dados: json });

                    // Se a API retornar uma lista de canais/touchpoints, capturamos os IDs numéricos
                    if (resp.ok && Array.isArray(json?.items || json)) {
                        const lista = json.items || json;
                        for (const item of lista) {
                            if (item.id) touchpointsDescobertos.add(String(item.id));
                            if (item.touchpoint) touchpointsDescobertos.add(String(item.touchpoint));
                            if (item.phoneNumberId) touchpointsDescobertos.add(String(item.phoneNumberId));
                        }
                    }
                } catch (e) {
                    diagnostico.etapa_3_canais_e_touchpoints.push({ url, erro: e.message });
                }
            }
        }

        // ETAPA 4: Consultar Templates oficiais (Step 1 da Documentação Messaging v2)
        for (const ak of diagnostico.etapa_2_accountKeys_descobertas) {
            for (const tp of touchpointsDescobertos) {
                const url = `https://api.goto.com/messaging/v2/accounts/${ak}/message-templates?ownerTouchpoint=${encodeURIComponent(tp)}`;
                try {
                    const resp = await fetch(url, { headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}` } });
                    const texto = await resp.text();
                    let json;
                    try { json = JSON.parse(texto); } catch (e) { json = texto; }

                    if (resp.ok) {
                        diagnostico.etapa_4_templates.push({
                            accountKey: ak,
                            ownerTouchpoint_valido: tp,
                            status: resp.status,
                            templates: json
                        });
                    } else if (resp.status !== 404) {
                        diagnostico.etapa_4_templates.push({
                            accountKey: ak,
                            ownerTouchpoint_testado: tp,
                            status: resp.status,
                            resposta: json
                        });
                    }
                } catch (e) {}
            }
        }

        res.json({
            sucesso: true,
            resultado: diagnostico
        });

    } catch (erro) {
        res.status(500).json({ sucesso: false, erro: erro.message });
    }
});

// ==========================================
// DISPARO DE MENSAGENS WHATSAPP (MESSAGING V2)
// ==========================================
app.post('/api/enviar-mensagem', async (req, res) => {
    try {
        const token = await obterTokenGoTo();
        const { 
            accountKey, 
            fromPhoneId, 
            to, 
            texto, 
            templateName, 
            templateParams = [] 
        } = req.body;

        if (!to || !fromPhoneId || !accountKey) {
            return res.status(400).json({ 
                erro: "Campos 'accountKey', 'fromPhoneId' e 'to' (ex: +5511999999999) sao obrigatorios." 
            });
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
                parameters: templateParams
            };
        } else {
            requestObj.type = "simple";
            requestObj.components = [
                {
                    type: "body",
                    components: [
                        {
                            type: "text",
                            attributes: { text: texto || "Olá! Contato da equipe de Relacionamento de Locação." }
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