declare namespace Cloudflare {
  interface Env {
    ADMIN_EMAIL: string;
    NAVER_MAPS_CLIENT_ID: string;
    DATA_GO_KR_SERVICE_KEY: string;
    RESEND_API_KEY: string;
    RESEND_FROM_EMAIL: string;
    APP_BASE_URL: string;
    GOOGLE_CLIENT_ID: string;
    GOOGLE_CLIENT_SECRET: string;
    NAVER_LOGIN_CLIENT_ID: string;
    NAVER_LOGIN_CLIENT_SECRET: string;
    KAKAO_REST_API_KEY: string;
    KAKAO_PLACE_VERIFICATION_ENABLED: string;
    KAKAO_PLACE_VERIFICATION_MODE: string;
    REVIEW_PHOTO_UPLOAD_ENABLED: string;
    REVIEW_PHOTOS: R2Bucket;
  }
}
