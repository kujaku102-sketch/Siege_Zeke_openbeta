// STD-228 征服の証
export const definition = {
  "id": "STD-228",
  "name": "征服の証",
  "category": "Code",
  "color": "橙",
  "cost": 7,
  "text": "これにカードをマウントできない。[アップデート:4]自分は3ダメージ受ける。これをランダムな相手エリアに配置する。",
  "classes": []
};

// placementPermissionSpec (was continuous-effect-specs.js)
export const placementPermissionSpec = [{ type: "forbid_mount_on_source" }];
