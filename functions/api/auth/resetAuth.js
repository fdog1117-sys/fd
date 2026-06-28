import { getDatabase } from "../../utils/databaseAdapter.js";
import { destroySessionsByAuthType } from "../../utils/auth/sessionManager.js";
import { timingSafeEqual } from "../../utils/auth/passwordHash.js";

/**
 * 认证重置接口
 * 
 * 使用方式：
 * 1. 设置环境变量 RESET_KEY（任意字符串，建议足够复杂）
 * 2. 以 POST 请求方式向 /api/auth/resetAuth 提交 JSON：{"key": "你设置的RESET_KEY"}
 * 3. 成功后所有认证配置被清除，可以直接进入管理端重新设置
 * 4. 用完后建议删除或更换 RESET_KEY 环境变量
 */
export async function onRequestPost(context) {
    const { request, env } = context;

    // 检查是否配置了重置密钥
    const resetKey = env.RESET_KEY;
    if (!resetKey || resetKey.trim() === '') {
        return new Response(JSON.stringify({
            error: 'RESET_KEY not configured. Set the RESET_KEY environment variable first.'
        }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // 从 JSON 请求体中获取密钥，避免 URL 泄露
    let key;
    try {
        const body = await request.json();
        key = body.key;
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Missing or invalid request body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    if (!key || !(await timingSafeEqual(key, resetKey))) {
        return new Response(JSON.stringify({ error: 'Invalid reset key' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const db = getDatabase(env);

        // 读取现有安全配置
        const settingsStr = await db.get('manage@sysConfig@security');
        if (settingsStr) {
            const settings = JSON.parse(settingsStr);
            // 只清除认证信息，保留其他安全设置（审核、域名白名单等）
            delete settings.auth;
            await db.put('manage@sysConfig@security', JSON.stringify(settings));
        }

        // 清除所有会话
        const adminDestroyed = await destroySessionsByAuthType(env, 'admin');
        const userDestroyed = await destroySessionsByAuthType(env, 'user');

        return new Response(JSON.stringify({
            success: true,
            message: 'Auth credentials reset. Other security settings preserved. All sessions cleared.',
            sessionsCleared: { admin: adminDestroyed, user: userDestroyed }
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (err) {
        return new Response(JSON.stringify({
            error: 'Reset failed: ' + err.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
