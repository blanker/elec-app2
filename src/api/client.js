import axios from 'axios';
import config from '../config/env';
import useUserStore from "@/store/useUserStore"
import { redirect } from "react-router";

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: config.apiHost,
  timeout: config.apiTimeout,
  headers: {
    'Content-Type': 'application/json',
  }
});

// 是否正在重定向的标志
let isRedirecting = false;
// 存储所有活跃请求的 AbortController
const activeRequests = new Map();

// 取消所有请求的函数
const cancelAllRequests = (reason = 'Unauthorized') => {
  activeRequests.forEach((controller, key) => {
    controller.abort(reason);
  });
  activeRequests.clear();
};

// 重定向到登录页的辅助函数
const redirectToLogin = () => {
  // 只要触发了需要登录的情况，立刻取消所有其他正在进行的请求
  cancelAllRequests('Authentication failed');

  if (isRedirecting) {
    return;
  }
  // 如果已经在登录页，则不处理
  if (window.location.hash.includes('#/login')) {
    return;
  }
  isRedirecting = true;
  window.location.href = '/#/login';
  
  // 重置标志，防止后续无法重定向（例如用户在不刷新的情况下重新登录又失败）
  // 这里设置一个较短的延时，足以覆盖并发请求的时间窗口
  setTimeout(() => {
    isRedirecting = false;
  }, 2000);
};

// 请求拦截器
apiClient.interceptors.request.use(
  (config) => {
    // 可以在这里添加认证信息等
    const token = useUserStore.getState().token;
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`;
    }

    // 创建 AbortController 并添加到配置中
    const controller = new AbortController();
    config.signal = controller.signal;
    
    // 使用请求的 URL 和时间戳作为唯一标识，或者使用 Symbol
    // 这里为了简单，直接把 controller 挂载到 config 对象的一个自定义属性上，方便响应时移除
    // 但是 Map 需要一个 key。使用 Symbol 作为 key。
    const requestKey = Symbol('request');
    config.requestKey = requestKey;
    activeRequests.set(requestKey, controller);

    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    // 请求成功，从 activeRequests 中移除
    if (response.config && response.config.requestKey) {
      activeRequests.delete(response.config.requestKey);
    }

    // 可以在这里统一处理响应
    // 401 跳转登录页
    // console.log('response', response);

    // 处理返回 200 但实际上是未授权的情况
    if (response.status === 200 && response.data) {
      const { success, message } = response.data;
      if (success === false && (message === "未授权访问" || message === "token无效或已过期")) {
        redirectToLogin();
        // 中断后续处理，抛出错误
        return Promise.reject(new Error(message));
      }
    }

    return response;
  },
  (error) => {
    // 请求失败，从 activeRequests 中移除
    if (error.config && error.config.requestKey) {
        activeRequests.delete(error.config.requestKey);
    }

    // 如果是取消请求导致的错误，不进行处理（或者根据需要处理）
    if (axios.isCancel(error)) {
        console.log('Request canceled', error.message);
        return Promise.reject(error);
    }

    // 统一处理错误
    // 401 跳转登录页
    console.log('error', error);
    
    const status = error.response ? error.response.status : error.status;
    
    if (status === 401) {
        // 使用 window.location 进行重定向
        redirectToLogin();
        // 返回一个永远不会 resolve 的 promise，或者直接 reject
        // 这里 return 可能会导致调用处的 catch 不执行或者执行 undefined，最好 reject
        return Promise.reject(error);
    }
    return Promise.reject(error);
  }
);

export default apiClient;