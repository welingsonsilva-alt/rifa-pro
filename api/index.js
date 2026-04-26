require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ASAAS_KEY = process.env.ASAAS_KEY;

app.get('/api/config', async (req, res) => {
    try {
        const { data } = await supabase.from('configuracoes').select('*');
        const config = {};
        if(data) data.forEach(item => config[item.chave] = { valor: item.valor });
        res.json(config);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/numeros', async (req, res) => {
    const { data } = await supabase.from('rifas').select('*').order('numero', { ascending: true });
    res.json(data || []);
});

app.get('/api/consulta/:cpf', async (req, res) => {
    const { data } = await supabase.from('rifas').select('*').eq('cpf_comprador', req.params.cpf.replace(/\D/g, '')).order('numero', { ascending: true });
    const agora = new Date();
    res.json((data || []).map(n => {
        const expiraEm = new Date(new Date(n.updated_at).getTime() + 10 * 60000);
        return { ...n, segundosRestantes: Math.max(0, Math.floor((expiraEm - agora) / 1000)) };
    }));
});

app.post('/api/checkout', async (req, res) => {
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

module.exports = app;