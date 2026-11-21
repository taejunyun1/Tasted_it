import { isDeploymentFenced } from "./deployment-fence";

export const ADMIN_SETTING_DEFINITIONS = [
  {key:"CST_MAINTENANCE",label:"서비스 점검",expected:"false",kind:"fence",consumer:"공개 요청·정기 작업의 데이터 접근 이전 점검 차단"},
  {key:"STUDENT_WORKSPACE_ENABLED",label:"학생 작업공간",expected:"true",kind:"boolean",consumer:"학생 진입·초대 수락·작업 및 관리자 학생 화면"},
  {key:"ONBOARDING_ENABLED",label:"비회원 취향·임시 저장",expected:"true",kind:"boolean",consumer:"취향 설정·임시 저장과 추천의 비회원 연결"},
  {key:"NAVER_PLACE_GEOCODING_ENABLED",label:"주소 검색 도구",expected:"true",kind:"boolean",consumer:"장소 제안·관리자 검수의 주소 검색 도구 표시"},
  {key:"NAVER_LOCAL_SEARCH_ENABLED",label:"NAVER 장소 검증",expected:"true",kind:"boolean",consumer:"검수·정기 검증의 NAVER 호출 허용; 자격정보·예산은 별도 조건"},
  {key:"REVIEW_PHOTO_UPLOAD_ENABLED",label:"리뷰 사진 업로드",expected:"false",kind:"boolean",consumer:"리뷰어 방문 기록의 사진 업로드 허용"},
  {key:"PLACE_CATEGORY_V5_ENABLED",label:"장소 분류 v5",expected:"false",kind:"unused",consumer:"설정은 있으나 현재 서비스에서 이 값을 읽는 경로가 없음"},
  {key:"COURSE_CONTEXT_V2_ENABLED",label:"코스 문맥 v2",expected:"false",kind:"boolean",consumer:"코스 추천에서 문맥 v2 적용"},
  {key:"REVIEW_CONFIDENT_ADVANCE_ENABLED",label:"검수 조건부 이동",expected:"true",kind:"boolean",consumer:"정해진 근거를 충족한 검수 단계 이동; 최종 공개는 별도 확인"},
  {key:"REVIEW_AUTO_PIPELINE_ENABLED",label:"동기화 후 자동 검수",expected:"true",kind:"boolean",consumer:"공공 동기화 이후 검수 파이프라인; 수집 성공 등 선행 조건 필요"},
  {key:"RSI_CLOUDFLARE_ENABLED",label:"서비스 경로 점검",expected:"true",kind:"boolean",consumer:"정해진 공개 경로 점검 허용; 실행 결과는 별도 확인"},
  {key:"KAKAO_PLACE_VERIFICATION_ENABLED",label:"Kakao 영업 상태 점검",expected:null,kind:"boolean",consumer:"정기 영업 상태 점검 허용; 자격정보는 별도 조건"},
  {key:"KAKAO_PLACE_VERIFICATION_MODE",label:"영업 상태 점검 모드",expected:null,kind:"mode",consumer:"미설정·잘못된 값은 OBSERVE로 해석"},
] as const;
type SettingKey = typeof ADMIN_SETTING_DEFINITIONS[number]["key"];
export type AdminSettingsEnvironment = Partial<Record<SettingKey,unknown>>;

/** Read only the allowlist. Never serialize the environment or an unknown value. */
export function readAdminSettings(environment: AdminSettingsEnvironment, observedAt: string) {
  return { observedAt, expectedSource:"wrangler.jsonc 기본값", observedSource:"현재 요청의 Worker 환경", injectionSource:"미확인", deploymentVersion:"미확인",
    settings:ADMIN_SETTING_DEFINITIONS.map(definition=>{
      const value=environment[definition.key];
      const knownMode=definition.kind==="mode" && ["OBSERVE","RECOMMEND","HIDE"].includes(String(value));
      const received=value===undefined?"MISSING":definition.kind==="mode"?(knownMode?String(value):"INVALID"):value==="true"?"TRUE":value==="false"?"FALSE":"INVALID";
      const normalized=value===undefined?null:received==="INVALID"?undefined:String(value);
      const effect=definition.kind==="unused"?"UNUSED":definition.kind==="mode"?(knownMode?String(value):"OBSERVE")
        :definition.kind==="fence"?(isDeploymentFenced(value)?"ENABLED":"DISABLED"):(value==="true"?"ENABLED":"DISABLED");
      const status=received==="INVALID"?"INVALID":definition.kind==="unused"?"UNUSED":received==="MISSING"?"MISSING"
        :normalized===definition.expected?"MATCH":"DIFFERENT";
      return {...definition,received,effect,status,matchesExpected:normalized===definition.expected};
    }),
  };
}
