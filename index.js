const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Configurações (Vercel Environment Variables)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ASAAS_KEY = process.env.ASAAS_KEY;

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));

// --- ROTAS DA API ---
app.get('/api/config', async (req, res) => {
    try {
        const { data } = await supabase.from('configuracoes').select('*');
        const config = {};
        if(data) data.forEach(item => config[item.chave] = { valor: item.valor });
        res.json(config);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/numeros', async (req, res) => {
    try {
        const { data } = await supabase.from('rifas').select('*').order('numero', { ascending: true });
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/checkout', async (req, res) => {
    const { numeros, nome, email, telefone, cpf, metodo } = req.body;
    try {
        const ASAAS_URL = 'https://www.asaas.com/api/v3';
        const buscaCli = await axios.get(`${ASAAS_URL}/customers?email=${email}`, { headers: { access_token: ASAAS_KEY } });
        let customerId = buscaCli.data.totalCount > 0 ? buscaCli.data.data[0].id : (await axios.post(`${ASAAS_URL}/customers`, { name: nome, email, cpfCnpj: cpf.replace(/\D/g, ''), mobilePhone: telefone.replace(/\D/g, '') }, { headers: { access_token: ASAAS_KEY } })).data.id;
        
        const payment = await axios.post(`${ASAAS_URL}/payments`, { 
            customer: customerId, 
            billingType: metodo, 
            value: numeros.length * 10, 
            dueDate: new Date().toISOString().split('T')[0], 
            description: `Rifa - Números: ${numeros.join(',')}` 
        }, { headers: { access_token: ASAAS_KEY } });

        const pixData = await axios.get(`${ASAAS_URL}/payments/${payment.data.id}/pixQrCode`, { headers: { access_token: ASAAS_KEY } });
        
        await supabase.from('rifas').update({ 
            status: 'reservado', 
            cpf_comprador: cpf.replace(/\D/g, ''), 
            id_pagamento: payment.data.id, 
            updated_at: new Date().toISOString() 
        }).in('numero', numeros);

        res.json({ pix_code: pixData.data.payload, pix_image: pixData.data.encodedImage });
    } catch (e) { res.status(500).json({ error: "Erro no checkout" }); }
});

// Rota coringa para o Frontend
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

module.exports = app;