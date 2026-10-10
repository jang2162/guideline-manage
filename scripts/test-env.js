// 기존 테스트는 한국어 문구를 단언한다. 셸의 설정과 상관없이 테스트는 한국어로 돈다(영어를 보는 테스트는 setLocale 로 바꾼다).
process.env.GUIDELINE_LANG = 'ko';
delete process.env.GUIDELINE_LOCALES_DIR;
