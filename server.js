import express from 'express';
import cors from 'cors';
import path from 'path';
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
        throw new Error("Credenciais GoTo ausentes nas variáveis de ambiente da Vercel.");
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
// 3. SETUP AUTOMÁTICO INTELIGENTE
// ==========================================
app.get('/api/setup-webhook', async (req, res) => {
    const historico = [];
    try {
        const token = await obterTokenGoTo();
        const baseUrl = `https://${req.headers.host}`;
        const webhookUrl = `${baseUrl}/webhook`;
        
        let channelId = null;

        // ETAPA 1: Consultar se já existe um canal registrado
        historico.push("[1] Verificando canais existentes via GET...");
        try {
            const consulta = await fetch('https://api.goto.com/notification-channel/v1/channels', {
                method: 'GET',
                headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}` }
            });

            if (consulta.ok) {
                const canais = await consulta.json();
                const lista = Array.isArray(canais) ? canais : (canais.items || canais.data || []);
                historico.push(`[1] Canais encontrados: ${lista.length}`);

                const canalEncontrado = lista.find(c => 
                    c.webhookUrl === webhookUrl || 
                    (c.channelData && c.channelData.webhookUrl === webhookUrl)
                ) || lista[0];

                if (canalEncontrado) {
                    channelId = canalEncontrado.channelId || canalEncontrado.id;
                    historico.push(`[1] Canal reaproveitado com sucesso: ${channelId}`);
                }
            } else {
                historico.push(`[1] GET status: ${consulta.status}`);
            }
        } catch (errGet) {
            historico.push(`[1] Falha no GET: ${errGet.message}`);
        }

        // ETAPA 2: Se não houver canal, cria testando variações de rota
        if (!channelId) {
            historico.push("[2] Tentando criação ativa do canal...");

            const tentativas = [
                // Tentativa A: com barra no final (evita redirecionamento 301 que converte POST em GET)
                {
                    url: 'https://api.goto.com/notification-channel/v1/channels/',
                    body: { channelType: "Webhook", webhookUrl: webhookUrl }
                },
                // Tentativa B: sem barra com channelData aninhado
                {
                    url: 'https://api.goto.com/notification-channel/v1/channels',
                    body: { channelType: "Webhook", channelData: { webhookUrl: webhookUrl } }
                },
                // Tentativa C: sem barra direto
                {
                    url: 'https://api.goto.com/notification-channel/v1/channels',
                    body: { channelType: "Webhook", webhookUrl: webhookUrl }
                }
            ];

            for (const tent of tentativas) {
                historico.push(`[2] Tentando POST em ${tent.url}...`);
                const canalResp = await fetch(tent.url, {
                    method: 'POST',
                    headers: {
                        ...HEADERS_API,
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(tent.body)
                });

                const respostaTexto = await canalResp.text();
                historico.push(`[2] Resposta status ${canalResp.status}: ${respostaTexto.slice(0, 150)}`);

                if (canalResp.ok) {
                    try {
                        const dados = JSON.parse(respostaTexto);
                        channelId = dados.channelId || dados.id;
                        historico.push(`[2] Canal criado com sucesso: ${channelId}`);
                        break;
                    } catch (e) {}
                }
            }
        }

        if (!channelId) {
            throw new Error(`Não foi possível obter ou criar um Canal de Notificação.\nDetalhes:\n${historico.join('\n')}`);
        }

        // ETAPA 3: Criar Assinatura na API v2 de Mensagens
        const accountKey = "5363286181559338501";
        historico.push(`[3] Registrando assinatura para a conta ${accountKey}...`);

        let subResp = await fetch('https://api.goto.com/messaging/v2/subscriptions', {
            method: 'POST',
            headers: {
                ...HEADERS_API,
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                accountKey: accountKey,
                ownerEntity: accountKey,
                ownerEntityType: "ORGANIZATION",
                channelId: channelId,
                eventTypes: ["INBOUND_MESSAGE", "OUTBOUND_MESSAGE", "DELIVERY_STATUS"]
            })
        });

        // Fallback sem ownerEntity se a API exigir formato simplificado
        if (!subResp.ok) {
            historico.push(`[3] Tentativa padrão falhou (${subResp.status}). Tentando formato simplificado...`);
            subResp = await fetch('https://api.goto.com/messaging/v2/subscriptions', {
                method: 'POST',
                headers: {
                    ...HEADERS_API,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    accountKey: accountKey,
                    channelId: channelId,
                    eventTypes: ["INBOUND_MESSAGE", "OUTBOUND_MESSAGE", "DELIVERY_STATUS"]
                })
            });
        }

        const subTexto = await subResp.text();
        if (!subResp.ok) {
            throw new Error(`Canal OK (${channelId}), mas falha na Assinatura (Status ${subResp.status}): ${subTexto}`);
        }

        let subDados = {};
        try { subDados = JSON.parse(subTexto); } catch(e) {}

        res.json({
            sucesso: true,
            mensagem: "Webhook e Assinatura configurados com SUCESSO na GoTo!",
            channelId: channelId,
            webhookUrlUtilizada: webhookUrl,
            assinatura: subDados,
            historicoExecucao: historico
        });

    } catch (erro) {
        console.error("[ERRO SETUP WEBHOOK]:", erro.message);
        res.status(500).json({ sucesso: false, erro: erro.message, historicoExecucao: historico });
    }
});

// ==========================================
// 4. OUVINTE DO WEBHOOK (RECEBE DADOS DA GOTO)
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
            console.log(`[Webhook] Mensagem recebida! Conversa: ${convId} (${tipo})`);
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
                if (gemini_key && mensagens.length > 0 && mensagens.some(m => m.texto.trim() !== "")) {
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

export default app;