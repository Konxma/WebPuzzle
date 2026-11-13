import {
  DEMO_PIECE_COUNT, MIN_PIECE_COUNT, MAX_PIECE_COUNT,
  isValidPieceCount, DEFAULT_PUZZLE_SHAPE, type PuzzleShape,
} from "@web-pazle/shared";
import { ObservableViewModel } from "../../../shared/mvvm/ObservableViewModel";
import type { HealthGateway } from "../models/HealthGateway";
import { MAX_SAVED_PUZZLE_NAME, type PuzzlePhotoGateway, type SavedPuzzle, type SavedPuzzleCatalog, type SavedPuzzleDetails } from "../models/PuzzleFiles";

interface LobbyState {
  connection: "idle" | "checking" | "online" | "offline";
  pieceCount: number;
  pieceCountInput: string;
  pieceCountError: string | null;
  minPieceCount: number;
  maxPieceCount: number;
  shape: PuzzleShape;
  imageSource: "default" | "photo";
  roomCode: string;
  roomCodeError: string | null;
  photo: File | null;
  photoError: string | null;
  busy: boolean;
  savedPuzzles: SavedPuzzle[];
  saveDetails: Record<string, SavedPuzzleDetails>;
  saveError: string | null;
  removingSave: boolean;
}
export class LobbyViewModel extends ObservableViewModel<LobbyState> {
  private savesRefresh = 0;
  private uploadedPhoto?: { file: File; id: string };
  constructor(private readonly health: HealthGateway,
    private readonly rooms: {create:(count:number,imageId?:string,shape?:PuzzleShape)=>Promise<void>;join:(id:string)=>Promise<void>;resume:(key:string)=>Promise<void>},
    private readonly photos: PuzzlePhotoGateway, private readonly saves: SavedPuzzleCatalog) {
    super({
      connection: "idle", pieceCount: DEMO_PIECE_COUNT,
      pieceCountInput: String(DEMO_PIECE_COUNT), pieceCountError: null,
      minPieceCount: MIN_PIECE_COUNT, maxPieceCount: MAX_PIECE_COUNT,
      shape: DEFAULT_PUZZLE_SHAPE, imageSource: "default", roomCode: "", roomCodeError: null,
      photo: null, photoError: null, busy: false, savedPuzzles: [], saveDetails: {}, saveError: null, removingSave: false,
    });
  }
  readonly setPieceCountInput = (input: string): void => {
    const count = Number(input);
    const valid = input.trim() !== "" && isValidPieceCount(count);
    this.setState({
      ...this.getSnapshot(),
      pieceCountInput: input,
      pieceCount: valid ? count : this.getSnapshot().pieceCount,
      pieceCountError: valid ? null : `Введіть ціле число від ${MIN_PIECE_COUNT} до ${MAX_PIECE_COUNT}`,
    });
  };
  readonly setRoomCode = (roomCode:string):void => this.setState({...this.getSnapshot(),roomCode,roomCodeError:null});
  readonly setShape = (shape: PuzzleShape) => this.setState({ ...this.getSnapshot(), shape });
  readonly setImageSource = (imageSource: LobbyState["imageSource"]) => {
    this.setState({ ...this.getSnapshot(), imageSource, photoError: null });
  };
  readonly choosePhoto = (photo: File) => {
    this.uploadedPhoto = undefined;
    this.setState({ ...this.getSnapshot(), imageSource: "photo", photo, photoError: null });
  };
  readonly refreshSaves = () => {
    const refresh = ++this.savesRefresh;
    const savedPuzzles = this.saves.list();
    this.setState({ ...this.getSnapshot(), savedPuzzles, saveDetails: {} });
    for (const save of savedPuzzles) {
      void this.saves.details(save).then(details => {
        if (!details || refresh !== this.savesRefresh) return;
        const state = this.getSnapshot();
        this.setState({ ...state, saveDetails: { ...state.saveDetails, [save.key]: details } });
      });
    }
  };

  readonly renamePuzzle = (key: string, value: string): string | null => {
    const name = value.trim();
    if (!name || name.length > MAX_SAVED_PUZZLE_NAME) return `Введіть назву від 1 до ${MAX_SAVED_PUZZLE_NAME} символів.`;
    try {
      this.saves.rename(key, name);
      this.setState({ ...this.getSnapshot(), savedPuzzles: this.saves.list() });
      return null;
    } catch {
      return "Не вдалося зберегти назву в браузері.";
    }
  };
  readonly removePuzzle = async (key: string) => {
    if (this.getSnapshot().busy) return;
    this.setState({ ...this.getSnapshot(), busy: true, saveError: null, removingSave: true });
    try {
      await this.saves.remove(key);
      this.refreshSaves();
    } catch (error) {
      this.setState({
        ...this.getSnapshot(),
        saveError: error instanceof Error && !(error instanceof TypeError)
          ? error.message : "Не вдалося видалити збереження. Перевірте з’єднання з грою.",
      });
    } finally {
      this.setState({ ...this.getSnapshot(), busy: false, removingSave: false });
    }
  };
  readonly continuePuzzle = (key: string) => {
    if (!this.getSnapshot().busy) void this.rooms.resume(key);
  };
  readonly createRoom = async (): Promise<void> => {
    const { pieceCount, pieceCountError, imageSource, photo, shape, busy } = this.getSnapshot();
    if (pieceCountError || busy || (imageSource === "photo" && !photo)) return;
    this.setState({ ...this.getSnapshot(), busy: true, photoError: null });
    try {
      let imageId: string | undefined;
      if (imageSource === "photo" && photo) {
        if (this.uploadedPhoto?.file !== photo) this.uploadedPhoto = { file: photo, id: await this.photos.upload(photo) };
        imageId = this.uploadedPhoto.id;
      }
      await this.rooms.create(pieceCount, imageId, shape);
    } catch (error) {
      this.setState({ ...this.getSnapshot(), photoError: error instanceof Error ? error.message : "Не вдалося підготувати фото." });
    } finally {
      this.setState({ ...this.getSnapshot(), busy: false });
    }
  };
  readonly joinRoom = ():void => {
    if (this.getSnapshot().busy) return;
    let room=this.getSnapshot().roomCode.trim();try{room=new URL(room).searchParams.get("room")??room;}catch{/* room id */}
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(room)){this.setState({...this.getSnapshot(),roomCodeError:"Вставте посилання на кімнату або її код"});return;}
    void this.rooms.join(room);
  };
  readonly checkConnection = async (): Promise<void> => {
    if (this.getSnapshot().connection === "checking") return;
    this.setState({ ...this.getSnapshot(), connection: "checking" });
    try {
      await this.health.check();
      this.setState({ ...this.getSnapshot(), connection: "online" });
    } catch {
      this.setState({ ...this.getSnapshot(), connection: "offline" });
    }
  };
}
