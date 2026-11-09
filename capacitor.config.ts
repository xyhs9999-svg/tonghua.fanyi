import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zhongyue.tonghua.fanyi',
  appName: '中越通话翻译',
  webDir: 'www',
  // 页面本身是本地 www/index.html；翻译接口、PeerJS 信令、备用翻译
  // 都是远程 HTTPS/WSS，直接调用，不用改。不要在这里配 server.url，
  // 否则 App 会变成一个在线网页壳，离线打不开。
};

export default config;
