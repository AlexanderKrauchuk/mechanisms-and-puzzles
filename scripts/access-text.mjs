import { MODULE_ID, t } from "./constants.mjs";

/** Текст о причине недоступности загадки: код результата проверки доступа → строка для игрока. */
export function accessText(access, scene) {
  if (access.code === "tooFar" && access.distance != null) {
    return game.i18n.format(`${MODULE_ID}.access.tooFarDetail`, {
      distance: Math.round(access.distance * 10) / 10,
      max: access.max,
      units: scene?.grid?.units ?? ""
    });
  }
  return t(`messages.${access.code}`);
}
