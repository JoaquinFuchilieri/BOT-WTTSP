require('dotenv').config();
const http = require('http');

async function runTests() {
  const BASE_URL = 'http://localhost:3000';
  console.log('=== INICIANDO PRUEBAS DE LA API ===');

  async function req(endpoint, method = 'GET', body = null, token = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : null
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  try {
    // 1. Health
    console.log('\n1. Test /health...');
    const health = await req('/health');
    console.log('Status:', health.status, health.data);
    if (health.status !== 200) throw new Error('Health failed');

    // 2. Login
    console.log('\n2. Test /auth/login (admin@demo.com)...');
    const login = await req('/auth/login', 'POST', {
      email: 'admin@demo.com',
      password: 'admin123'
    });
    console.log('Status:', login.status, 'User:', login.data.user);
    if (login.status !== 200 || !login.data.accessToken) throw new Error('Login failed');
    const token = login.data.accessToken;

    // 3. Create Profile
    console.log('\n3. Test POST /profiles...');
    const createProfile = await req('/profiles', 'POST', {
      name: 'Perfil de Test Cloud',
      message: 'Hola desde el servidor centralizado!',
      delay_min: 115,
      delay_max: 145,
      batch_size: 15,
      daily_limit: 200
    }, token);
    console.log('Status:', createProfile.status, 'Profile ID:', createProfile.data.id);
    if (createProfile.status !== 201) throw new Error('Profile creation failed');
    const profileId = createProfile.data.id;

    // 4. Import numbers to queue
    console.log('\n4. Test POST /profiles/:id/queue/import...');
    const importRes = await req(`/profiles/${profileId}/queue/import`, 'POST', {
      numbers: ['+5491122334455', '5491199887766', '+5491122334455'] // Contains duplicate to test dedup
    }, token);
    console.log('Status:', importRes.status, 'Result:', importRes.data);
    if (importRes.status !== 200 || importRes.data.imported !== 2) throw new Error('Import dedup failed');

    // 5. Atomic next number
    console.log('\n5. Test GET /profiles/:id/queue/next...');
    const nextRes = await req(`/profiles/${profileId}/queue/next`, 'GET', null, token);
    console.log('Status:', nextRes.status, 'Next number:', nextRes.data);
    if (nextRes.status !== 200 || !nextRes.data.item) throw new Error('Queue next failed');
    const queueId = nextRes.data.item.id;
    const phone = nextRes.data.item.phone_number;

    // 6. Mark sent
    console.log('\n6. Test POST /profiles/:id/queue/:qid/sent...');
    const sentRes = await req(`/profiles/${profileId}/queue/${queueId}/sent`, 'POST', {
      phoneNumber: phone
    }, token);
    console.log('Status:', sentRes.status, 'Result:', sentRes.data);
    if (sentRes.status !== 200) throw new Error('Mark sent failed');

    // 7. Check stats
    console.log('\n7. Test GET /stats/profiles/:id...');
    const statsRes = await req(`/stats/profiles/${profileId}`, 'GET', null, token);
    console.log('Status:', statsRes.status, 'Stats:', statsRes.data);
    if (statsRes.status !== 200 || statsRes.data.sentToday !== 1 || statsRes.data.pending !== 1) {
      throw new Error('Stats mismatch');
    }

    console.log('\n=== TODAS LAS PRUEBAS DEL SERVIDOR PASARON CON ÉXITO! ===\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ ERROR EN LAS PRUEBAS:', err);
    process.exit(1);
  }
}

runTests();
