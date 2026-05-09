/* eslint-disable */

addEventListener('fetch', (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  try {
    const url = new URL(request.url);

    // 如果訪問根目錄，返回HTML
    if (url.pathname === '/') {
      return new Response(getRootHtml(), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
        },
      });
    }

    // 從請求路徑中提取目標 URL
    let actualUrlStr = decodeURIComponent(url.pathname.replace('/', ''));

    // 判斷用戶輸入的 URL 是否帶有協議
    actualUrlStr = ensureProtocol(actualUrlStr, url.protocol);

    // 保留查詢參數
    actualUrlStr += url.search;

    // 創建新 Headers 對象，排除以 'cf-' 開頭的請求頭
    const newHeaders = filterHeaders(
      request.headers,
      (name) => !name.startsWith('cf-')
    );

    // 創建一個新的請求以訪問目標 URL
    const modifiedRequest = new Request(actualUrlStr, {
      headers: newHeaders,
      method: request.method,
      body: request.body,
      redirect: 'manual',
    });

    // 發起對目標 URL 的請求
    const response = await fetch(modifiedRequest);
    let body = response.body;

    // 處理重定向
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      body = response.body;
      // 創建新的 Response 對象以修改 Location 頭部
      return handleRedirect(response, body);
    } else if (response.headers.get('Content-Type')?.includes('text/html')) {
      body = await handleHtmlContent(
        response,
        url.protocol,
        url.host,
        actualUrlStr
      );
    }

    // 創建修改後的響應對象
    const modifiedResponse = new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });

    // 添加禁用緩存的頭部
    setNoCacheHeaders(modifiedResponse.headers);

    // 添加 CORS 頭部，允許跨域訪問
    setCorsHeaders(modifiedResponse.headers);

    return modifiedResponse;
  } catch (error) {
    // 如果請求目標地址時出現錯誤，返回帶有錯誤消息的響應和狀態碼 500（服務器錯誤）
    return jsonResponse(
      {
        error: error.message,
      },
      500
    );
  }
}

// 確保 URL 帶有協議
function ensureProtocol(url, defaultProtocol) {
  return url.startsWith('http://') || url.startsWith('https://')
    ? url
    : defaultProtocol + '//' + url;
}

// 處理重定向
function handleRedirect(response, body) {
  const location = new URL(response.headers.get('location'));
  const modifiedLocation = `/${encodeURIComponent(location.toString())}`;
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: {
      ...response.headers,
      Location: modifiedLocation,
    },
  });
}

// 處理 HTML 內容中的相對路徑
async function handleHtmlContent(response, protocol, host, actualUrlStr) {
  const originalText = await response.text();
  const regex = new RegExp('((href|src|action)=["\'])/(?!/)', 'g');
  let modifiedText = replaceRelativePaths(
    originalText,
    protocol,
    host,
    new URL(actualUrlStr).origin
  );

  return modifiedText;
}

// 替換 HTML 內容中的相對路徑
function replaceRelativePaths(text, protocol, host, origin) {
  const regex = new RegExp('((href|src|action)=["\'])/(?!/)', 'g');
  return text.replace(regex, `$1${protocol}//${host}/${origin}/`);
}

// 返回 JSON 格式的響應
function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

// 過濾請求頭
function filterHeaders(headers, filterFunc) {
  return new Headers([...headers].filter(([name]) => filterFunc(name)));
}

// 設置禁用緩存的頭部
function setNoCacheHeaders(headers) {
  headers.set('Cache-Control', 'no-store');
}

// 設置 CORS 頭部
function setCorsHeaders(headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  headers.set('Access-Control-Allow-Headers', '*');
}

// 返回根目錄的 HTML
function getRootHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <link href="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/css/materialize.min.css" rel="stylesheet">
  <title>Proxy Everything</title>
  <link rel="icon" type="image/png" href="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="Description" content="Proxy Everything with CF Workers.">
  <meta property="og:description" content="Proxy Everything with CF Workers.">
  <meta property="og:image" content="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="robots" content="index, follow">
  <meta http-equiv="Content-Language" content="zh-CN">
  <meta name="copyright" content="Copyright © ymyuuu">
  <meta name="author" content="ymyuuu">
  <link rel="apple-touch-icon-precomposed" sizes="120x120" href="https://img.icons8.com/color/1000/kawaii-bread-1.png">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="viewport" content="width=device-width, user-scalable=no, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no">
  <style>
      body, html {
          height: 100%;
          margin: 0;
      }
      .background {
          background-image: url('https://imgapi.cn/bing.php');
          background-size: cover;
          background-position: center;
          height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
      }
      .card {
          background-color: rgba(255, 255, 255, 0.8);
          transition: background-color 0.3s ease, box-shadow 0.3s ease;
      }
      .card:hover {
          background-color: rgba(255, 255, 255, 1);
          box-shadow: 0px 8px 16px rgba(0, 0, 0, 0.3);
      }
      .input-field input[type=text] {
          color: #2c3e50;
      }
      .input-field input[type=text]:focus+label {
          color: #2c3e50 !important;
      }
      .input-field input[type=text]:focus {
          border-bottom: 1px solid #2c3e50 !important;
          box-shadow: 0 1px 0 0 #2c3e50 !important;
      }
  </style>
</head>
<body>
  <div class="background">
      <div class="container">
          <div class="row">
              <div class="col s12 m8 offset-m2 l6 offset-l3">
                  <div class="card">
                      <div class="card-content">
                          <span class="card-title center-align"><i class="material-icons left">link</i>Proxy Everything</span>
                          <form id="urlForm" onsubmit="redirectToProxy(event)">
                              <div class="input-field">
                                  <input type="text" id="targetUrl" placeholder="在此輸入目標地址" required>
                                  <label for="targetUrl">目標地址</label>
                              </div>
                              <button type="submit" class="btn waves-effect waves-light teal darken-2 full-width">跳轉</button>
                          </form>
                      </div>
                  </div>
              </div>
          </div>
      </div>
  </div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/materialize/1.0.0/js/materialize.min.js"></script>
  <script>
      function redirectToProxy(event) {
          event.preventDefault();
          const targetUrl = document.getElementById('targetUrl').value.trim();
          const currentOrigin = window.location.origin;
          window.open(currentOrigin + '/' + encodeURIComponent(targetUrl), '_blank');
      }
  </script>
</body>
</html>`;
}
