import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ==========================================
// 1. CONFIGURAÇÕES & SEGURANÇA (VERCEL)
// ==========================================
// Na Vercel, pegamos tudo das Variáveis de Ambiente
const gemini_key = process.env.GEMINI_KEY || "";
const ai = new GoogleGenAI({ apiKey: gemini_key });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// IMPORTANTE: Na Vercel (Serverless), a memória reinicia de tempos em tempos.
// Para um PoC, funciona bem para testes rápidos em tempo real.
const bancoDeConversas = new Map();
const cacheAnalisesIA = new Map();

let gotoTokenCache = { token: null, expiraEm: 0, refreshToken: null };

const HEADERS_API = {
    'Accept': 'application/json',
    'User-Agent': 'GoTo-Webhook-Client/1.0'
};

// ==========================================
// 2. AUTENTICAÇÃO OAUTH 2.0
// ==========================================
async function obterTokenGoTo() {
    const agora = Date.now();
    if (gotoTokenCache.token && agora < gotoTokenCache.expiraEm - 60000) {
        return gotoTokenCache.token;
    }

    const clientId = process.env.GOTO_CLIENT_ID;
    const clientSecret = process.env.GOTO_CLIENT_SECRET;
    const refreshToken = gotoTokenCache.refreshToken || process.env.GOTO_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error("Credenciais GoTo ausentes nas Variáveis de Ambiente da Vercel.");
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

    if (!resposta.ok) throw new Error(`Falha na autenticação GoTo: ${await resposta.text()}`);

    const dados = await resposta.json();
    gotoTokenCache.token = dados.access_token;
    gotoTokenCache.expiraEm = agora + (dados.expires_in * 1000);
    if (dados.refresh_token) gotoTokenCache.refreshToken = dados.refresh_token;

    return gotoTokenCache.token;
}

// ==========================================
// 3. SCRIPT DE SETUP AUTOMÁTICO (DINÂMICO)
// ==========================================
app.get('/api/setup-webhook', async (req, res) => {
    try {
        const token = await obterTokenGoTo();
        
        // Pega automaticamente a URL segura (https) gerada pela Vercel!
        const baseUrl = `https://${req.headers.host}`;
        const webhookUrl = `${baseUrl}/webhook`;
        
        console.log(`\n[Setup] Iniciando registro seguro do Webhook: ${webhookUrl}`);

        // PASSO 1: Criar Canal (v2 com fallback para v1)
        const payloadCanal = JSON.stringify({
            channelType: "Webhook", webhookUrl: webhookUrl, channelData: { webhookUrl: webhookUrl }
        });

        let canalResp = await fetch('https://api.goto.com/notification-channel/v2/channels', {
            method: 'POST', headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: payloadCanal
        });

        if (!canalResp.ok && canalResp.status !== 403) {
            canalResp = await fetch('https://api.goto.com/notification-channel/v1/channels', {
                method: 'POST', headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: payloadCanal
            });
        }

        if (!canalResp.ok) throw new Error(`Falha no Canal: ${await canalResp.text()}`);
        const canalDados = await canalResp.json();
        const channelId = canalDados.channelId || canalDados.id;

        // PASSO 2: Assinatura
        const accountKey = "5363286181559338501"; 
        const subResp = await fetch('https://api.goto.com/messaging/v2/subscriptions', {
            method: 'POST', headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                accountKey, ownerEntity: accountKey, ownerEntityType: "ORGANIZATION",
                channelId, eventTypes: ["INBOUND_MESSAGE", "OUTBOUND_MESSAGE", "DELIVERY_STATUS"]
            })
        });

        if (!subResp.ok) throw new Error(`Falha na Assinatura: ${await subResp.text()}`);

        res.json({
            sucesso: true,
            mensagem: "Webhook HTTPS cadastrado com SUCESSO ABSOLUTO na GoTo!",
            webhookUrlUtilizada: webhookUrl
        });

    } catch (erro) {
        res.status(500).json({ sucesso: false, erro: erro.message });
    }
});

// ==========================================
// 4. OUVINTE DO WEBHOOK
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
                id: convId, fila: `WhatsApp Lello`, consultor: payload.authorTouchpoint || "Sistema",
                startTime: evento.timestamp, status: 'ABERTA', mensagens: []
            });
        }

        const conversa = bancoDeConversas.get(convId);

        if (tipo === 'INBOUND_MESSAGE' || tipo === 'OUTBOUND_MESSAGE') {
            conversa.mensagens.push({
                origem: tipo === 'INBOUND_MESSAGE' ? 'cliente' : 'consultor',
                texto: payload.body || "[Mídia/Anexo]", hora: payload.timestamp || evento.timestamp
            });
        }

        if (tipo === 'CONVERSATION_CLOSED' || payload.status === 'CLOSED') conversa.status = 'FECHADA';

        res.status(200).json({ sucesso: true });
    } catch (e) {
        res.status(500).send("Erro interno ao processar.");
    }
});

// ==========================================
// 5. CÁLCULOS & IA PARA O DASHBOARD
// ==========================================
function calcularMinutos(inicio, fim) {
    if (!inicio || !fim) return null;
    return Math.max(0, Math.round((new Date(fim) - new Date(inicio)) / 60000));
}

function calcularTMR(mensagens) {
    let tempos = [];
    let ultimaMsgCliente = null;
    const msgsOrdenadas = mensagens.sort((a, b) => new Date(a.hora) - new Date(b.hora));

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
// 6. ROTA DO DASHBOARD
// ==========================================
app.get('/api/dashboard', async (req, res) => {
    try {
        const conversasArray = Array.from(bancoDeConversas.values());

        const dadosTratados = await Promise.all(conversasArray.map(async (c) => {
            const mensagens = c.mensagens;
            const inicio = c.startTime;
            
            const primeiraResposta = mensagens.find(m => m.origem === 'consultor')?.hora;
            const conclusao = c.status === 'FECHADA' ? mensagens[mensagens.length - 1]?.hora : null;

            const tme = calcularMinutos(inicio, primeiraResposta);
            const tma = calcularMinutos(primeiraResposta, conclusao);
            const tmr = calcularTMR(mensagens);
            const pendente = mensagens[mensagens.length - 1]?.origem === 'cliente';

            const chaveCache = `${c.id}_${mensagens.length}`;
            let semantica = cacheAnalisesIA.get(chaveCache);

            if (!semantica) {
                if (mensagens.length > 0 && mensagens.some(m => m.texto.trim() !== "")) {
                    const prompt = `Analise a conversa:\n${mensagens.map(m => `${m.origem}:${m.texto}`).join('\n')}`;
                    const response = await ai.models.generateContent({
                        model: 'gemini-3.8-flash', contents: prompt,
                        config: { responseMimeType: "application/json", responseSchema: esquemaIA, temperature: 0.1 }
                    });
                    semantica = JSON.parse(response.text);
                } else {
                    semantica = { assunto_resumido: "Novo Contato", sentimento_inferido: "Neutro" };
                }
                cacheAnalisesIA.set(chaveCache, semantica);
            }

            return {
                id: c.id, data: inicio.split('T')[0], fila: c.fila, consultor: c.consultor,
                tme_val: tme, tma_val: tma, tmr_val: tmr, nota_goto: null,
                tme_texto: tme !== null ? `${tme} min` : "Na fila",
                tma_texto: tma !== null ? `${tma} min` : "Em Andamento",
                tmr_texto: tmr !== null ? `${tmr} min` : "N/D",
                status: pendente ? "Pendente" : "Respondido",
                assunto: semantica.assunto_resumido, qualidade_resumo: semantica.sentimento_inferido
            };
        }));

        res.json({ sucesso: true, dados: dadosTratados, origem: "vercel_webhook" });
    } catch (erro) {
        res.status(500).json({ sucesso: false, erro: erro.message });
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Exportando para a Vercel Serverless
export default app;