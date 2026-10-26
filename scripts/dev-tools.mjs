import {startDeveloperServer} from './developer-server.mjs';
try {
  const server = await startDeveloperServer({port: Number(process.env.DEVTOOLS_PORT ?? 4318)});
  console.log(`개발자 백오피스: http://127.0.0.1:${server.address().port}/`);
  console.log('앱 번들 전용 · 읽기 전용 · 종료: Ctrl+C');
} catch (error) {
  console.error(`개발 도구 시작 실패: ${error.message}`);
  process.exitCode = 1;
}
