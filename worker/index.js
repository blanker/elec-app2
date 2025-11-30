import { AutoRouter, cors, json, error } from 'itty-router' // ~1kB
import {
  saveResponses,
  savePublicityInfoList,
  getPublicityInfoList,
  statResponses,
  statResponseGroupByRundate,
  getResponsesByRundate,
} from './publicity-info.js';
import { saveDevices } from './device.js';
import { saveDeclaration, statDeclarationRundates, getDeclarationsByRundate } from './declaration.js';
import { saveAccounts, saveAccountAgent, getAccounts } from './account.js';
import { saveCustomer } from './customer.js';
import { saveSettlements, saveSettlementDetail, countByMonth, fetchByMonth, fetchDetailByMonth } from './settlement.js';
import { newUser, login, authMiddleware, switchTenant } from './user.js';
import { getTenant } from './tenant.js';
import {saveInfoPublictiList, saveInfoPublictiListList} from './info-publicity.js'

const { preflight, corsify } = cors({
  origin: '*',
  // origin: true,
  // origin: 'https://foo.bar',
  // origin: ['https://foo.bar', 'https://dog.cat'],
  // origin: /oo.bar$/,
  // origin: (origin) => origin.endsWith('foo.bar') ? origin : undefined,
  // credentials: true,
  allowMethods: '*',
  // allowMethods: 'GET, POST',
  // allowMethods: ['GET', 'POST'],
  // allowHeaders: 'x-foo, x-bar',
  allowHeaders: ['content-type', 'x-bar', 'authorization'],
  // exposeHeaders: 'x-foo, x-bar',
  // exposeHeaders: ['x-foo', 'x-bar'],
  maxAge: 84600,
})
const router = AutoRouter({
  before: [preflight],  // add preflight upstream
  finally: [corsify],   // and corsify downstream
})

// MIDDLEWARE: withAuthenticatedUser - embeds user in Request or returns a 401
const withAuthenticatedUser = async (request, env) => {
  // 不拦截 /api/private/login 
  if (request.url.includes('/api/private/login')) {
    return;
  }

  // return;

  const user = await authMiddleware(request, env);

  // by returning early here, we cut off all future handlers
  if (!user.success) return error(401, 'Invalid user.')

  // otherwise, we embed the user for future use
  request.userId = user.userId;
  request.user = user.user;
}

// New middleware for forwarding /api/table-data requests to https://xuanweijiuxie.cn
// Placed after the withAuthenticatedUser definition
const forwardMiddleware = async (request, env, ctx, next) => {
  try {
    console.log('[Forward Middleware] Triggered for:', request.url);
    // 获取目标主机地址，优先使用环境变量配置
      const targetHost = env.TARGET_HOST || 'https://admin.xuanweijiuxie.cn';
    const remoteBase = targetHost;
    const remoteUrl = remoteBase + new URL(request.url).pathname.replace('/api/table-data', '/api/v2/private/crawl/proxy/table-data');

    // Clone the request to safely forward the body
    const clonedRequest = request.clone();

    const forwardedRequest = new Request(remoteUrl, {
      method: clonedRequest.method,
      headers: clonedRequest.headers,
      body: clonedRequest.body,
      redirect: 'manual',
    });

    // Asynchronous forward, ignore errors and do not await
    const forwarding = fetch(forwardedRequest)
      .then(res => {
        if (!res.ok) {
          console.error(`[Forward Fail] ${remoteUrl} status: ${res.status}`);
        } else {
          console.log(`[Forward Success] ${remoteUrl} status: ${res.status}`);
        }
      })
      .catch(err => {
        console.error(`[Forward Error] ${remoteUrl} failed:`, err);
      });

    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(forwarding);
    }
  } catch (err) {
    console.error('[Forward Middleware] Execution failed:', err);
  }

  // Continue to next handler
  return ;
};
router
  .all('/api/private/*', withAuthenticatedUser)
  // Add the middleware before the specific /api/table-data POST routes
  // Assuming insertion after router.all('/api/private/*', withAuthenticatedUser)
  .all('/api/table-data/*', forwardMiddleware)
  .get('/api/hello/:name', ({ name }) => `Hello, ${name}!`)
  .get('/api/json', () => json({ name: 'json' }))
  .get('/api', () => json({ name: 'gogo' }))
  .get('/api/promises', () => Promise.resolve('foo'))

router.post('/api/foo', (request, env, context) => new Response(JSON.stringify({ foo: 'bar' }), {
  headers: { 'Content-Type': 'application/json' },
}));

router.post('/api/table-device/', saveDevices);

router.post('/api/table-data/account', saveAccounts);
router.post('/api/table-data/account-agent', saveAccountAgent);
router.post('/api/private/accounts', getAccounts);

router.post('/api/table-data/daily-demand-market/', saveDeclaration);
router.post('/api/private/rundates', statDeclarationRundates);
router.post('/api/private/rundate-data', getDeclarationsByRundate);

router.post('/api/table-data/publicity-info', savePublicityInfoList);
router.post('/api/private/publicity-infos', getPublicityInfoList);
router.post('/api/table-data/bu-response-cap', saveResponses);
router.post('/api/private/responses', statResponses);
router.post('/api/private/stat-response-group-by-rundate', statResponseGroupByRundate);
router.post('/api/private/get-responses-by-rundate', getResponsesByRundate);

router.post('/api/table-data/info-publcity', saveInfoPublictiList);
router.post('/api/table-data/info-publcity-list', saveInfoPublictiListList);

router.post('/api/table-data/customer', saveCustomer);

router.post('/api/table-data/settlement', saveSettlements);
router.post('/api/table-data/settlement-detail', saveSettlementDetail);
router.post('/api/private/settlement-count-by-month', countByMonth);
router.post('/api/private/settlements-by-month', fetchByMonth);
router.post('/api/private/settlement-detail-by-month', fetchDetailByMonth);

router.post('/api/private/table-data/new-user', newUser);
router.post('/api/private/login', login);
router.post('/api/private/switchTenant', switchTenant);

router.post('/api/private/tenants', getTenant);

// export default router;

// worker\index.js
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 如果路径是 /api/proxy，则转发请求
    if (url.pathname.startsWith('/api/proxy')) {
      // 获取目标主机地址，优先使用环境变量配置
      const targetHost = env.TARGET_HOST || 'https://admin.xuanweijiuxie.cn';
      
      // 提取目标路径，例如 /api/proxy/some/path -> https://xuanweijiuxie.cn/some/path
      const targetPath = url.pathname.replace('/api/proxy', '/api/v2/private/crawl/proxy');
      const targetUrl = `${targetHost}${targetPath}${url.search}`;

      console.log('request.url', request.url, url.pathname, env.TARGET_HOST, 'target', targetUrl);

      // 复制请求头和方法
      const proxyRequest = new Request(targetUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });

      // 发送代理请求
      const response = await fetch(proxyRequest);

      // 创建新的 Response，确保使用 response.body
      // 使用 new Response(response.body, ...) 会消耗原始 stream，避免 "A ReadableStream branch was created but never consumed" 错误
      // 注意：response.body 只能被读取一次，这里我们直接传递给新响应
      const corsResponse = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
      
      // 添加 CORS 头
      corsResponse.headers.set('Access-Control-Allow-Origin', '*');  // 或指定你的前端域名，如 'https://elec.blanker.cc'
      corsResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      corsResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      return corsResponse;
    }

    // 处理 OPTIONS 预检请求（CORS 必需）
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
      });
    }

    // 其他路径交给 router 处理
    return router.fetch(request, env, ctx);
  },
};

// export default {
//   fetch(request, env) {
//     const url = new URL(request.url);

//     if (url.pathname.startsWith("/api/")) {
//       return Response.json({
//         name: "Cloudflare",
//       });
//     }

//     return new Response(null, { status: 404 });
//   },
// }
