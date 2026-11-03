import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ==========================================
// 1. CONFIGURAÇÕES & SEGURANÇA
// ==========================================
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

// Fallbacks seguros atualizados com as credenciais oficiais da GoTo
const PADRAO_CLIENT_ID = "3253a422-73e1-4585-af2e-590f6111d494";
const PADRAO_CLIENT_SECRET = "pBn8JYvMPlJz7mk9XgIuHO3p";
const PADRAO_CHANNEL_ID = "49889407-3cc9-47b1-b33d-afa97956e162";
const PADRAO_REFRESH_TOKEN = "eyJraWQiOiI2MjAiLCJhbGciOiJSUzUxMiJ9.eyJzYyI6ImNhbGwtY29udHJvbC52MS5jYWxscy5jb250cm9sIGFzc2V0LnYxLm5vdGlmaWNhdGlvbnMubWFuYWdlIGNhbGxzLnYyLmluaXRpYXRlIG1lc3NhZ2luZy52MS53cml0ZSBpZGVudGl0eTpzY2ltLm1lIGNhbGwtZXZlbnRzLnYxLmV2ZW50cy5yZWFkIGNjLWFuYWx5dGljcy52MS5hZ2VudC1zdGF0dXMucmVhZCB1c2Vycy52MS5yZWFkIG1lc3NhZ2luZy52MS5ub3RpZmljYXRpb25zLm1hbmFnZSB2b2ljZW1haWwudjEubm90aWZpY2F0aW9ucy5tYW5hZ2UgY2FsbC1wYXJraW5nLnYxLm5vdGlmaWNhdGlvbnMubWFuYWdlIHZvaWNlbWFpbC52MS52b2ljZW1haWxzLndyaXRlIHN1cHBvcnQ6IHJlY29yZGluZy52MS5ub3RpZmljYXRpb25zLm1hbmFnZSBmYXgudjEud3JpdGUgdm9pY2UtYWRtaW4udjEud3JpdGUgd2VicnRjLnYxLndyaXRlIHdlYnJ0Yy52MS5yZWFkIGlkZW50aXR5OiBjb2xsYWI6IHF1ZXVlLWNhbGxlci52MS5yZWFkIHZvaWNlLWFkbWluLnYxLnJlYWQgcHJlc2VuY2UudjEucmVhZCBjb250YWN0cy52MS5yZWFkIHJlY29yZGluZy52MS5yZWFkIGNhbGwtZXZlbnRzLnYxLm5vdGlmaWNhdGlvbnMubWFuYWdlIGlkZW50aXR5OnNjaW0ub3JnIHByZXNlbmNlLnYxLndyaXRlIGZheC52MS5yZWFkIGNvbnRhY3RzLnYxLndyaXRlIGNhbGwtaGlzdG9yeS52MS5ub3RpZmljYXRpb25zLm1hbmFnZSBwcmVzZW5jZS52MS5ub3RpZmljYXRpb25zLm1hbmFnZSBtZXNzYWdpbmcudjEuc2VuZCBjYWxsLXBhcmtpbmcudjEucmVhZCBtZXNzYWdpbmcudjEucmVhZCBjci52MS5yZWFkIGZheC52MS5ub3RpZmljYXRpb25zLm1hbmFnZSB1c2Vycy52MS5saW5lcy5yZWFkIHZvaWNlbWFpbC52MS52b2ljZW1haWxzLnJlYWQiLCJzdWIiOiIyMjgyNDI0OTE2MDUzMDAzMDIwIiwiYXVkIjoiMzI1M2E0MjItNzNlMS00NTg1LWFmMmUtNTkwZjYxMTFkNDk0Iiwib2duIjoicHdkIiwidHlwIjoiciIsImxldmVsT2ZBc3N1cmFuY2UiOjIsImV4cCI6MTc5NjMzMTkzOCwiaWF0IjoxNzkzNzM5OTM4LCJqdGkiOiIyNTZjY2NiZC0zMTU3LTQ4YzItOTgwOC0zNGQ4YzYyYmZhN2YifQ.m6ztojoArZN69JzCJNFAeG-C7FSWOazUHGpzfImusBXmg3efOFhLHh473H9JnWhlv4Oj3tE7ugqi_fEnzVhIVmaW1YhdVOU0Ja5o49fmxAtB919k2hvL1i1Ce9W2h-39Hh7KLkzcKHmLefKskZiEMvEFfyMSxAVQ7oQhsDXhSBFFW4jbXtnBRwbmwW3fWD01-E6-TmgfMiWio-wcOOJH-fliOTOaU2EsaqXzZ4ucxc1Ib5ucFKaJR9YaVnxf4KGI72gQ6kSpWwKboIHQWI3ltvMCgNNvdj_pnORk0xK737GNwattOYF716gVMOZxzlPfiEa0NysodEBxkvHZTcaXUw";

function obterCredenciais(req = null) {
    let local = {};
    const caminhos = [
        path.join(process.cwd(), 'data', 'goto_config.json'),
        path.join(__dirname, 'data', 'goto_config.json'),
        path.join(process.cwd(), 'goto_config.json')
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
    const refreshToken = (gotoTokenCache.refreshToken || process.env.GOTO_REFRESH_TOKEN || local.refresh_token || PADRAO_REFRESH_TOKEN).trim();
    const channelId = (local.channel_id || PADRAO_CHANNEL_ID).trim();

    return { clientId, clientSecret, refreshToken, channelId };
}

// ==========================================
// 2. ROTA AUTOMÁTICA: TROCAR CODE POR REFRESH_TOKEN
// ==========================================
app.get('/api/gerar-token', async (req, res) => {
    try {
        let code = req.query.code;
        if (!code) {
            return res.status(400).json({ sucesso: false, erro: "Falta o parametro ?code= na URL." });
        }

        if (code.includes('code=')) {
            code = code.split('code=')[1].split('&')[0];
        }
        code = decodeURIComponent(code).trim();

        const { clientId, clientSecret } = obterCredenciais(req);
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
                code: code,
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
                credenciais_utilizadas: {
                    client_id: clientId,
                    secret_preview: `${clientSecret.slice(0, 3)}...${clientSecret.slice(-3)} (tam: ${clientSecret.length})`,
                    redirect_uri: redirectUri
                },
                detalhe: dados
            });
        }

        gotoTokenCache.token = dados.access_token;
        gotoTokenCache.expiraEm = Date.now() + (dados.expires_in * 1000);
        if (dados.refresh_token) {
            gotoTokenCache.refreshToken = dados.refresh_token;
        }

        res.json({
            sucesso: true,
            mensagem: "Refresh Token obtido e ativado com sucesso!",
            refresh_token: dados.refresh_token,
            access_token: dados.access_token,
            expira_em_segundos: dados.expires_in
        });
    } catch (e) {
        res.status(500).json({ sucesso: false, erro: e.message });
    }
});

// ==========================================
// 3. AUTENTICAÇÃO OAUTH 2.0 (RENOVAÇÃO)
// ==========================================
async function obterTokenGoTo() {
    const agora = Date.now();
    if (gotoTokenCache.token && agora < gotoTokenCache.expiraEm - 60000) {
        return gotoTokenCache.token;
    }

    const { clientId, clientSecret, refreshToken } = obterCredenciais();

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error("Credenciais GoTo ausentes.");
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

    if (!resposta.ok) {
        const erroMsg = await resposta.text();
        throw new Error(`Falha na autenticacao GoTo: ${erroMsg}`);
    }

    const dados = await resposta.json();
    gotoTokenCache.token = dados.access_token;
    gotoTokenCache.expiraEm = agora + (dados.expires_in * 1000);
    if (dados.refresh_token) gotoTokenCache.refreshToken = dados.refresh_token;

    return gotoTokenCache.token;
}

// ==========================================
// 4. CONSULTA DE TEMPLATES DIRETO NO CANAL ESPECÍFICO
// ==========================================
app.get('/api/check-templates', async (req, res) => {
    const resultados = [];
    try {
        const token = await obterTokenGoTo();
        const { channelId: configChannelId } = obterCredenciais();
        const channelId = req.query.channelId || configChannelId || PADRAO_CHANNEL_ID;

        const rotasParaTestar = [
            `https://api.goto.com/messaging/v1/channels/${channelId}`,
            `https://api.goto.com/messaging/v2/channels/${channelId}`,
            `https://api.goto.com/messaging/v1/channels/${channelId}/templates`,
            `https://api.goto.com/messaging/v2/channels/${channelId}/templates`,
            `https://api.goto.com/messaging/v1/templates?channelId=${channelId}`,
            `https://api.goto.com/messaging/v2/templates?channelId=${channelId}`,
            'https://api.goto.com/messaging/v1/channels'
        ];

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
            canal_consultado: channelId,
            escopos_token: ["messaging.v1.send", "messaging.v1.write", "messaging.v1.read"],
            testes: resultados
        });

    } catch (erro) {
        res.status(500).json({ sucesso: false, erro: erro.message });
    }
});

// ==========================================
// 5. OUVINTE DO WEBHOOK
// ==========================================
app.post('/webhook', (req, res) => {
    try {
        const evento = req.body;
        if (!evento || evento.source !== 'inbox-notification') return res.status(200).send("Ignorado.");

        const tipo = evento.type;
        const payload = evento.content?.payload;
        if (!payload || !payload.conversationId) return res.status(200).send("Ignorado.");

        const convId = payload.conversationId;

        if (!bancoDeConversas.has(convId)) {
            bancoDeConversas.set(convId, {
                id: convId,
                fila: `WhatsApp Contact Center`,
                consultor: payload.authorTouchpoint || "Equipe",
                startTime: evento.timestamp,
                status: 'ABERTA',
                mensagens: []
            });
        }

        const conversa = bancoDeConversas.get(convId);

        if (tipo === 'INBOUND_MESSAGE' || tipo === 'OUTBOUND_MESSAGE') {
            conversa.mensagens.push({
                origem: tipo === 'INBOUND_MESSAGE' ? 'cliente' : 'consultor',
                texto: payload.body || "[Mídia/Anexo]",
                hora: payload.timestamp || evento.timestamp
            });
        }

        if (tipo === 'CONVERSATION_CLOSED' || payload.status === 'CLOSED') {
            conversa.status = 'FECHADA';
        }

        res.status(200).json({ sucesso: true });
    } catch (e) {
        res.status(500).send("Erro interno no webhook.");
    }
});

// ==========================================
// 6. CÁLCULOS & IA PARA O DASHBOARD
// ==========================================
function calcularMinutos(inicio, fim) {
    if (!inicio || !fim) return null;
    return Math.max(0, Math.round((new Date(fim) - new Date(inicio)) / 60000));
}

function calcularTMR(mensagens) {
    let tempos = [];
    let ultimaMsgCliente = null;
    const msgsOrdenadas = [...mensagens].sort((a, b) => new Date(a.hora) - new Date(b.hora));

    for (const msg of msgsOrdenadas) {
        if (msg.origem === 'cliente' && msg.hora) ultimaMsgCliente = new Date(msg.hora);
        else if (msg.origem === 'consultor' && ultimaMsgCliente && msg.hora) {
            tempos.push(Math.max(0, Math.round((new Date(msg.hora) - ultimaMsgCliente) / 60000)));
            ultimaMsgCliente = null;
        }
    }
    return tempos.length === 0 ? null : Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length);
}

const esquemaIA = {
    type: Type.OBJECT,
    properties: {
        assunto_resumido: { type: Type.STRING, description: "Motivo do contato em até 4 palavras" },
        sentimento_inferido: { type: Type.STRING, description: "Satisfeito, Neutro ou Insatisfeito" }
    },
    required: ["assunto_resumido", "sentimento_inferido"]
};

// ==========================================
// 7. ROTA DO DASHBOARD
// ==========================================
app.get('/api/dashboard', async (req, res) => {
    try {
        let conversasArray = Array.from(bancoDeConversas.values());

        if (conversasArray.length === 0) {
            const caminhoMock = path.join(process.cwd(), 'data', 'conversas_mock.json');
            if (fs.existsSync(caminhoMock)) {
                try {
                    const mock = JSON.parse(fs.readFileSync(caminhoMock, 'utf-8'));
                    conversasArray = Array.isArray(mock) ? mock : (mock.conversas || []);
                } catch (e) {}
            }
        }

        const dadosTratados = await Promise.all(conversasArray.map(async (c) => {
            const mensagens = c.mensagens || [];
            const inicio = c.startTime || new Date().toISOString();
            
            const primeiraResposta = mensagens.find(m => m.origem === 'consultor')?.hora;
            const conclusao = c.status === 'FECHADA' ? mensagens[mensagens.length - 1]?.hora : null;

            const tme = calcularMinutos(inicio, primeiraResposta);
            const tma = calcularMinutos(primeiraResposta, conclusao);
            const tmr = calcularTMR(mensagens);
            const pendente = mensagens[mensagens.length - 1]?.origem === 'cliente';

            const chaveCache = `${c.id}_${mensagens.length}`;
            let semantica = cacheAnalisesIA.get(chaveCache);

            if (!semantica) {
                if (gemini_key && mensagens.length > 0 && mensagens.some(m => m.texto && m.texto.trim() !== "")) {
                    try {
                        const prompt = `Analise a conversa:\n${mensagens.map(m => `${m.origem}:${m.texto}`).join('\n')}`;
                        const response = await ai.models.generateContent({
                            model: 'gemini-3.8-flash', contents: prompt,
                            config: { responseMimeType: "application/json", responseSchema: esquemaIA, temperature: 0.1 }
                        });
                        semantica = JSON.parse(response.text);
                    } catch (errIA) {
                        semantica = { assunto_resumido: "Atendimento Geral", sentimento_inferido: "Neutro" };
                    }
                } else {
                    semantica = { assunto_resumido: "Atendimento Geral", sentimento_inferido: "Neutro" };
                }
                cacheAnalisesIA.set(chaveCache, semantica);
            }

            return {
                id: c.id, 
                data: inicio.split('T')[0], 
                fila: c.fila || "WhatsApp", 
                consultor: c.consultor || "Consultor",
                tme_val: tme, tma_val: tma, tmr_val: tmr, nota_goto: null,
                tme_texto: tme !== null ? `${tme} min` : "Na fila",
                tma_texto: tma !== null ? `${tma} min` : "Em Andamento",
                tmr_texto: tmr !== null ? `${tmr} min` : "N/D",
                status: pendente ? "Pendente" : "Respondido",
                assunto: semantica.assunto_resumido, 
                qualidade_resumo: semantica.sentimento_inferido
            };
        }));

        res.json({ sucesso: true, dados: dadosTratados, origem: "servidor_vercel" });
    } catch (erro) {
        res.status(500).json({ sucesso: false, erro: erro.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

export default app;