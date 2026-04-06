ETS 토익 기출 보카 PWA 패키지

구성
- index.html : 메인 앱
- manifest.webmanifest : 설치 정보
- sw.js : 오프라인 캐시용 서비스워커
- icons/*.png : 앱 아이콘

사용 방법
1) 이 폴더를 정적 웹서버(HTTPS 또는 localhost)에 올립니다.
   - 가장 쉬운 방법: Netlify / Vercel / GitHub Pages 등에 업로드
   - PC에서 테스트: 이 폴더에서 `python -m http.server 8000` 실행 후 브라우저로 접속
2) Chrome/Edge/삼성인터넷에서 열면 앱 설치 또는 홈 화면 추가가 가능합니다.
3) 설치 후에는 오프라인에서도 기존 캐시로 실행됩니다.

주의
- file:// 로 직접 index.html을 여는 경우 PWA 설치 및 서비스워커가 동작하지 않습니다.
- TTS의 en-US / en-GB 음성 품질은 기기와 브라우저 음성 엔진에 따라 달라질 수 있습니다.
- 학습 기록(암기, 오답)은 브라우저 localStorage에 저장됩니다.

Android 팁
- Chrome(Android): 우측 상단 메뉴 > 홈 화면에 추가 또는 앱 설치
- 삼성인터넷: 메뉴 > 현재 페이지 추가 > 홈 화면
