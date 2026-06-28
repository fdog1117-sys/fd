import sentryPlugin from "@cloudflare/pages-plugin-sentry";
import '@sentry/tracing';
import { fetchOthersConfig } from "./sysConfig";
import { checkDatabaseConfig as checkDbConfig } from './databaseAdapter.js';

let disableTelemetry = false;

export async function errorHandling(context) {
  // 读取KV中的设置
  const othersConfig = await fetchOthersConfig(context.env);
  disableTelemetry = !othersConfig.telemetry.enabled;

  const env = context.env;
  if (!disableTelemetry) {
    context.data.telemetry = true;
    let remoteSampleRate = 0.001;
    try {
      const sampleRate = await fetchSampleRate(context)
      //check if the sample rate is not null
      if (sampleRate) {
        remoteSampleRate = sampleRate;
      }
    } catch (e) { console.log(e) }
    const sampleRate = env.sampleRate || remoteSampleRate;
    return sentryPlugin({
      dsn: "https://44b7b443108ec6d298044b125ff89d28@o4507644548022272.ingest.us.sentry.io/4507644555100160",
      tracesSampleRate: sampleRate,
    })(context);;
  }

  return context.next();
}

export async function telemetryData(context) {
  // 读取KV中的设置
  const othersConfig = await fetchOthersConfig(context.env);
  disableTelemetry = !othersConfig.telemetry.enabled;
  
  if (!disableTelemetry) {
    try {
      const parsedHeaders = {};
      const sensitiveHeaders = ['cookie', 'authorization', 'authcode', 'set-cookie'];
      context.request.headers.forEach((value, key) => {
        const lowerKey = key.toLowerCase();
        if (sensitiveHeaders.includes(lowerKey)) {
          parsedHeaders[key] = '[FILTERED]';
          context.data.sentry.setTag(key, '[FILTERED]');
        } else {
          parsedHeaders[key] = value;
          //check if the value is empty
          if (value.length > 0) {
            context.data.sentry.setTag(key, value);
          }
        }
      });
      const CF = JSON.parse(JSON.stringify(context.request.cf));
      const parsedCF = {};
      for (const key in CF) {
        if (typeof CF[key] == "object") {
          parsedCF[key] = JSON.stringify(CF[key]);
        } else {
          parsedCF[key] = CF[key];
          if (CF[key].length > 0) {
            context.data.sentry.setTag(key, CF[key]);
          }
        }
      }
      const data = {
        headers: parsedHeaders,
        cf: parsedCF,
        url: context.request.url,
        method: context.request.method,
        redirect: context.request.redirect,
      }
      //get the url path
      const urlPath = new URL(context.request.url).pathname;
      const hostname = new URL(context.request.url).hostname;
      context.data.sentry.setTag("path", urlPath);
      context.data.sentry.setTag("url", data.url);
      context.data.sentry.setTag("method", context.request.method);
      context.data.sentry.setTag("redirect", context.request.redirect);
      context.data.sentry.setContext("request", data);
      const transaction = context.data.sentry.startTransaction({ name: `${context.request.method} ${hostname}` });
      //add the transaction to the context
      context.data.transaction = transaction;
      return await context.next();
    } catch (e) {
      console.log(e);
    } finally {
      context.data.transaction.finish();
    }
  }

  return context.next();
}

export async function traceData(context, span, op, name) {
  const data = context.data
  if (data.telemetry) {
    if (span) {
      console.log("span finish")
      span.finish();
    } else {
      console.log("span start")
      span = await context.data.transaction.startChild(
        { op: op, name: name },
      );
    }
  }
}

async function fetchSampleRate(context) {
  const data = context.data
  if (data.telemetry) {
    // 动态采样率拉取增加超时和降级保护，避免三方站点劫持控制流量或导致性能问题
    try {
      const url = "https://frozen-sentinel.pages.dev/signal/sampleRate.json";
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (response.ok) {
        const json = await response.json();
        // 限制采样率不能超过 0.05
        return Math.min(json.rate || 0.001, 0.05);
      }
    } catch (e) {
      console.log("Failed to fetch sample rate, fallback to default", e);
    }
    return 0.001; // 默认降级安全低采样率
  }
}

// 检查数据库是否配置
export async function checkDatabaseConfig(context) {
  var env = context.env;

  var dbConfig = checkDbConfig(env);

  if (!dbConfig.configured) {
    return new Response(
      JSON.stringify({
        success: false,
        error: "数据库未配置 / Database not configured",
        message: "请配置 KV 存储 (env.img_url) 或 D1 数据库 (env.img_d1)。 / Please configure KV storage (env.img_url) or D1 database (env.img_d1)."
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }

  // 继续执行
  return await context.next();
}