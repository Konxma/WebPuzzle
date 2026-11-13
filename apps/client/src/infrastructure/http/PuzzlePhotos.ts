import { BOARD_HEIGHT, BOARD_WIDTH, MAX_PUZZLE_PHOTO_BYTES, isPuzzleFileId } from "@web-pazle/shared";
import type { PuzzlePhotoGateway } from "../../features/lobby/models/PuzzleFiles";

export class PuzzlePhotos implements PuzzlePhotoGateway {
  async upload(file: File): Promise<string> {
    if (!/\.(jpe?g|png|webp)$/i.test(file.name) && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      throw new Error("Виберіть фото у форматі JPG, PNG або WebP.");
    }
    if (file.size > 25 * 1024 * 1024) throw new Error("Виберіть фото до 25 МБ.");
    const bitmap = await createImageBitmap(file).catch(() => { throw new Error("Браузер не зміг прочитати фото."); });
    const canvas = document.createElement("canvas");
    try {
      // Use one crop for the board, its reference and all players.
      const ratio = BOARD_WIDTH / BOARD_HEIGHT;
      const width = Math.min(bitmap.width, bitmap.height * ratio);
      const height = width / ratio;
      const scale = Math.min(1, 3200 / width);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Не вдалося підготувати фото.");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, (bitmap.width - width) / 2, (bitmap.height - height) / 2, width, height, 0, 0, canvas.width, canvas.height);
    } finally {
      bitmap.close();
    }
    const photo = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .9));
    if (!photo || photo.size > MAX_PUZZLE_PHOTO_BYTES) throw new Error("Не вдалося підготувати фото. Виберіть менший файл.");
    const response = await fetch("/api/photos", {
      method: "POST", body: photo, headers: { "Content-Type": "image/jpeg" }, signal: AbortSignal.timeout(30000),
    }).catch(() => { throw new Error("Не вдалося надіслати фото на ПК господаря."); });
    if (!response.ok) throw new Error("Сервер не прийняв фото. Перевірте запуск гри та спробуйте ще раз.");
    const result = await response.json();
    if (!isPuzzleFileId(result.imageId)) throw new Error("Сервер не повернув адресу фото.");
    return result.imageId;
  }
}
