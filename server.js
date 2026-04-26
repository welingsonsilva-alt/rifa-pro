require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ASAAS_KEY = '$aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjllOWUyMTRiLTA4ODAtNGE3My1hYTQ0LTIzZTVlOTVjMjI1NTo6JGFhY2hfZDhmNjgyNWMtNzJiOS00OThkLWJmZDctZWNhNzJmMmNjMGRl';

// --- ROTA DE WEBHOOK (Confirmação Automática) ---
app.post('/webhook', async (req, res) => {
    const { event, payment } = req.body;

    console.log(`🔔 Evento recebido do Asaas: ${event}`);

    // Se o pagamento foi confirmado ou recebido
    if (event === 'PAYMENT_CONFIRMED' || event === 'PAYMENT_RECEIVED') {
        const paymentId = payment.id;

        // Atualiza no Supabase todos os números que possuem esse ID de pagamento
        const { data, error } = await supabase
            .from('rifas')
            .update({ status: 'pago' })
            .eq('id_pagamento', paymentId);

        if (error) {
            console.error('❌ Erro ao atualizar status no banco:', error);
            return res.status(500).send('Erro interno');
        }

        console.log(`✅ Sucesso! Números do pagamento ${paymentId} marcados como PAGO.`);
    }

    // O Asaas precisa receber um 200 OK para saber que a mensagem chegou
    res.status(200).send('OK');
});

// Mantemos as outras rotas...
app.get('/config', async (req, res) => {
    const { data } = await supabase.from('configuracoes').select('*');
    const config = {};
    if(data) data.forEach(item => config[item.chave] = { valor: item.valor });
    res.json(config);
});

app.get('/numeros', async (req, res) => {
    const { data } = await supabase.from('rifas').select('*').order('numero', { ascending: true });
    res.json(data || []);
});

app.get('/consulta/:cpf', async (req, res) => {
    const { data } = await supabase.from('rifas').select('*').eq('cpf_comprador', req.params.cpf.replace(/\D/g, '')).order('numero', { ascending: true });
    const agora = new Date();
    res.json((data || []).map(n => {
        const expiraEm = new Date(new Date(n.updated_at).getTime() + 10 * 60000);
        return { ...n, segundosRestantes: Math.max(0, Math.floor((expiraEm - agora) / 1000)) };
    }));
});

app.post('/checkout', async (req, res) => {
    let { numeros, nome, email, telefone, cpf, metodo } = req.body;
    try {
        const ASAAS_URL = 'https://www.asaas.com/api/v3';
        const buscaCli = await axios.get(`${ASAAS_URL}/customers?email=${email}`, { headers: { access_token: ASAAS_KEY } });
        let customerId = buscaCli.data.totalCount > 0 ? buscaCli.data.data[0].id : (await axios.post(`${ASAAS_URL}/customers`, { name: nome, email, cpfCnpj: cpf.replace(/\D/g, ''), mobilePhone: telefone.replace(/\D/g, '') }, { headers: { access_token: ASAAS_KEY } })).data.id;
        const payment = await axios.post(`${ASAAS_URL}/payments`, { customer: customerId, billingType: metodo, value: numeros.length * 10, dueDate: new Date().toISOString().split('T')[0], description: `Rifa` }, { headers: { access_token: ASAAS_KEY } });
        const pixData = await axios.get(`${ASAAS_URL}/payments/${payment.data.id}/pixQrCode`, { headers: { access_token: ASAAS_KEY } });
        await supabase.from('rifas').update({ status: 'reservado', cpf_comprador: cpf.replace(/\D/g, ''), id_pagamento: payment.data.id, updated_at: new Date().toISOString() }).in('numero', numeros);
        res.json({ pix_code: pixData.data.payload, pix_image: pixData.data.encodedImage });
    } catch (e) { res.status(500).json({ error: true }); }
});

app.listen(3000, () => console.log('🚀 Servidor com Webhook Ativo na porta 3000'));
