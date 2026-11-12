const DEFAULTS = {
    apiKey: "",
    apiBase: "https://api.deepseek.com",
    apiModel: "deepseek-flash",
    enableWordCloud: false,
    minSize: 5,
};

function show_status(text, time) {
    const status = document.getElementById("status");
    status.textContent = text;
    clearTimeout(show_status.timer);
    if (time) {
        show_status.timer = setTimeout(() => {
            status.textContent = "";
        }, time);
    }
}

function normalizeBase(value) {
    const base = String(value || "").trim().replace(/\/+$/, "");
    return base || DEFAULTS.apiBase;
}

// 匹配模式里不能带端口，所以只用 host
function originPattern(base) {
    try {
        const url = new URL(base);
        return `${url.protocol}//${url.hostname}/*`;
    } catch (e) {
        return null;
    }
}

function readForm() {
    return {
        apiKey: document.getElementById("api-key").value.trim(),
        apiBase: normalizeBase(document.getElementById("api-base").value),
        apiModel: document.getElementById("api-model").value.trim() || DEFAULTS.apiModel,
        enableWordCloud: document.getElementById("enable-wordcloud").checked,
    };
}

// 自定义接口地址需要用户授权该域名，否则 service worker 的 fetch 会被拦
function ensureHostPermission(settings) {
    const pattern = originPattern(settings.apiBase);
    if (!pattern) {
        return Promise.resolve(false);
    }
    return new Promise((resolve) => {
        chrome.permissions.contains({ origins: [pattern] }, (granted) => {
            if (granted) {
                resolve(true);
                return;
            }
            chrome.permissions.request({ origins: [pattern] }, (ok) => resolve(!!ok));
        });
    });
}

function save_options() {
    const settings = readForm();
    if (!originPattern(settings.apiBase)) {
        show_status("接口地址格式不正确");
        return;
    }
    // 必须在用户点击的手势里申请权限，放到 storage 回调里会失效
    ensureHostPermission(settings).then((granted) => {
        chrome.storage.sync.set(settings, () => {
            if (!settings.apiKey) {
                show_status("已保存，但还没有填 API Key");
            } else if (!granted) {
                show_status("已保存，但未授权访问该域名，请求会被拦截");
            } else {
                show_status("保存成功", 1500);
            }
        });
    });
}

function test_connection() {
    const settings = readForm();
    if (!settings.apiKey) {
        show_status("先填 API Key");
        return;
    }
    show_status("连接中…");

    ensureHostPermission(settings).then((granted) => {
        if (!granted) {
            show_status("未授权访问该域名");
            return;
        }
        fetch(`${settings.apiBase}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${settings.apiKey}`,
            },
            body: JSON.stringify({
                model: settings.apiModel,
                messages: [{ role: "user", content: "ping" }],
                max_tokens: 5,
                thinking: { type: "disabled" },
            }),
        })
            .then(async (resp) => {
                const text = await resp.text();
                if (resp.ok) {
                    show_status("连接正常", 2000);
                    return;
                }
                let detail = text.slice(0, 120);
                try {
                    const json = JSON.parse(text);
                    detail = (json.error && (json.error.message || json.error)) || detail;
                } catch (e) {
                    // 保持原始文本
                }
                show_status(`失败 ${resp.status}：${detail}`);
            })
            .catch((err) => show_status(`连接失败：${err.message}`));
    });
}

function restore_options() {
    chrome.storage.sync.get(DEFAULTS, (items) => {
        document.getElementById("api-key").value = items.apiKey || "";
        document.getElementById("api-base").value = items.apiBase || DEFAULTS.apiBase;
        document.getElementById("api-model").value = items.apiModel || DEFAULTS.apiModel;
        document.getElementById("enable-wordcloud").checked = !!items.enableWordCloud;
    });
}

document.addEventListener("DOMContentLoaded", restore_options);
document.getElementById("save").addEventListener("click", save_options);
document.getElementById("test").addEventListener("click", test_connection);
