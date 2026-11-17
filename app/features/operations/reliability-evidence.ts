// Reviewed, version-pinned manifest. Never accepts user-supplied evidence URLs.
export const RELIABILITY_EVIDENCE = [
  {
    "title": "B09 배포·공개 경로 확인",
    "kind": "DEPLOYMENT_PROBE",
    "path": "docs/evidence/cst-20261210/b09-place-live-20261114.json",
    "sourceCommit": "941a205c3bd1fcf2eed634318b5578c07c38e88f",
    "sha256": "547bb21497164b8b407fcd994b04d0436bb27b3feb39353d769bc427c71d5633",
    "href": "https://github.com/taejunyun1/Tasted_it/blob/941a205c3bd1fcf2eed634318b5578c07c38e88f/docs/evidence/cst-20261210/b09-place-live-20261114.json"
  },
  {
    "title": "D1 로컬 합성 복원 연습",
    "kind": "LOCAL_SYNTHETIC",
    "path": "docs/evidence/cst-20261210/d1-local-roundtrip-main-3bc7758.json",
    "sourceCommit": "941a205c3bd1fcf2eed634318b5578c07c38e88f",
    "sha256": "ac4ae1aaa841c15bba955547324ba54b192049cc6c81a467c93cf300725690ce",
    "href": "https://github.com/taejunyun1/Tasted_it/blob/941a205c3bd1fcf2eed634318b5578c07c38e88f/docs/evidence/cst-20261210/d1-local-roundtrip-main-3bc7758.json"
  }
] as const;
