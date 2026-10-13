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

        // ETAPA 1: Consultar se já existe algum canal
        historico.push("[1] Verificando se já existe canal criado...");
        try {
            const consulta = await fetch('https://api.goto.com/notification-channel/v1/channels', {
                method: 'GET',
                headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}` }
            });

            if (consulta.ok) {
                const canais = await consulta.json();
                const lista = Array.isArray(canais) ? canais : (canais.items || canais.data || []);
                const existente = lista.find(c => (c.webhookUrl === webhookUrl || c.channelData?.webhookUrl === webhookUrl));
                if (existente) {
                    channelId = existente.channelId || existente.id;
                    historico.push(`[1] Canal existente reaproveitado: ${channelId}`);
                }
            }
        } catch (e) {
            historico.push(`[1] Falha consulta GET: ${e.message}`);
        }

        // ETAPA 2: Criar Canal via POST
        if (!channelId) {
            historico.push(`[2] Criando canal específico para Webhook: ${webhookUrl}`);

            const canalResp = await fetch('https://api.goto.com/notification-channel/v1/channels/webhook', {
                method: 'POST',
                headers: {
                    ...HEADERS_API,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    channelType: "Webhook",
                    webhookUrl: webhookUrl
                })
            });

            const corpoResposta = await canalResp.text();
            historico.push(`[2] Status Criação Canal ${canalResp.status}: ${corpoResposta.slice(0, 180)}`);

            if (canalResp.ok) {
                try {
                    const dados = JSON.parse(corpoResposta);
                    channelId = dados.channelId || dados.id;
                    historico.push(`[2] Canal criado com sucesso: ${channelId}`);
                } catch (err) {}
            }
        }

        if (!channelId) {
            throw new Error(`Falha ao obter/registrar canal de Webhook.\nHistórico:\n${historico.join('\n')}`);
        }

        // ETAPA 3: Criar Assinatura na API v2 com Testes de Hierarquia
        const accountKey = "5363286181559338501";
        
        // Puxa o seu UserId para tentar inscrever como USER
        let userId = null;
        historico.push("[3] Buscando Perfil (UserId) para Permissões...");
        try {
            const meResp = await fetch('https://api.goto.com/users/v1/me', {
                headers: { ...HEADERS_API, 'Authorization': `Bearer ${token}` }
            });
            if (meResp.ok) {
                const meDados = await meResp.json();
                userId = meDados.id || meDados.userKey;
                historico.push(`[3] Perfil localizado: User ID = ${userId}`);
            }
        } catch(e) {}

        historico.push(`[3] Testando Permissões de Assinatura para o canal ${channelId}...`);

        // Testamos do mais provável para o menos provável
        const tentativasHierarquia = [
            { ownerEntityType: "ACCOUNT", ownerEntity: accountKey },
            { ownerEntityType: "USER", ownerEntity: userId },
            { ownerEntityType: "ORGANIZATION", ownerEntity: accountKey }
        ];

        let subDados = null;
        let erroFinal = "";

        for (const tent of tentativasHierarquia) {
            if (!tent.ownerEntity) continue;
            
            historico.push(`[3] Tentando registrar como ${tent.ownerEntityType}...`);
            const subResp = await fetch('https://api.goto.com/messaging/v2/subscriptions', {
                method: 'POST',
                headers: {
                    ...HEADERS_API,
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    accountKey: accountKey,
                    ownerEntity: tent.ownerEntity,
                    ownerEntityType: tent.ownerEntityType,
                    channelId: channelId,
                    eventTypes: ["INBOUND_MESSAGE", "OUTBOUND_MESSAGE", "DELIVERY_STATUS"]
                })
            });

            const subTexto = await subResp.text();
            
            if (subResp.ok) {
                try { subDados = JSON.parse(subTexto); } catch(e) { subDados = { info: "Assinatura Registrada" }; }
                historico.push(`[3] SUCESSO ABSOLUTO! Assinatura registrada no nível ${tent.ownerEntityType}!`);
                break; // Aprovado, para o loop!
            } else {
                erroFinal = subTexto;
                historico.push(`[3] Negado no nível ${tent.ownerEntityType} (Status ${subResp.status})`);
            }
        }

        if (!subDados) {
            throw new Error(`Canal Criado (${channelId}), mas todas as permissões de Assinatura foram Negadas.\nÚltimo erro: ${erroFinal}`);
        }

        res.json({
            sucesso: true,
            mensagem: "Webhook e Assinatura registrados com SUCESSO na GoTo!",
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