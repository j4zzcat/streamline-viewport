import {context} from "../context";
import {BasePlugin} from "../utils/plugin";
import {IStreamController, IStreamProvider} from "./backend";
import {WebSocket} from "ws";

export class UnifiStreamsProxy {
    private _logger = context.createChildLogger(UnifiStreamProvider.name);
    private _wss;

    constructor() {
    }

    private initialize() {
        this._wss = context.createWebSocketServer(8087);
        this._wss.once("listening", () => {
            this._logger.debug(`WebSocketServer listening on port '${this._wss.address().port}'`);
            // console.log(`WebSocketServer listening on port '${this._wss.address().port}'`);
        })

        // this._wss.on("connection", (ws: WebSocket, request) => {
        // this._logger.debug(`Client '${clientId(request)}' wants to connect, request path is '${request.url}'`);
            // console.log(`Client '${clientId(request)}' wants to connect, request path is '${request.url}'`);

            // ws.on("message", (ws: WebSocket, request) => {
            //     const { type, topic } = JSON.parse(request);
            //     switch(type) {
            //         case "subscribe":
            //             this._logger.debug(`Client '${clientId(request)}' wants to subscribe to '${topic}'`);
            //
            //             let stream = this._streamsById.get(topic);
            //             if(stream != undefined) {
            //                 this._logger.debug(`Found Stream '${stream.id}'`);
            //                 // stream.start(ws);
            //
            //             } else {
            //                 this._logger.warn(`Can't find stream with topic '${topic}'`);
            //                 ws.send(JSON.stringify({error: "Unknown stream id"}))
            //                 ws.close();
            //             }
            //
            //             break;
            //
            //         case "unsubscribe":
            //             break;
            //
            //         default:
            //             ws.send(JSON.stringify({ error: "Unknown message type" }));
            //     }
            // })
        // });
    }

    public dispose() {
        this._wss.close();
    }
}

export class UnifiStreamProvider extends BasePlugin implements IStreamProvider {
    private _logger = context.createChildLogger(UnifiStreamProvider.name);

    private _unifiStreamsProxy = context.createUnifiStreamsProxy();
    private _unifiNvrsById = new Map<string, UnifiNvr>();
    private _unifiStreamsById = new Map<string, IStreamController>();

    constructor() {
        super("unifi");
    }

    dispose() {
        this._unifiStreamsProxy.dispose();

        this._unifiStreamsById.forEach((unifiStreamController, key) => {
            unifiStreamController.stop();
            unifiStreamController.dispose();
        });

        this._unifiNvrsById.forEach((unifiNvr, key) => {
            unifiNvr.dispose();
        });
    }

    /**
     * Handles URLs in the form of unifi://.../camera/...
     */
    public canHandle(url: URL): boolean {
        if(url.protocol.split(':')[0] == "unifi" &&
            decodeURI(url.pathname).split('/')[1] == "camera") {
            return true;
        } else {
            return false;
        }
    }

    public async createStreamControllers(url: URL): Promise<IStreamController[]> {
        let splitPathname = decodeURI(url.pathname).split('/');
        if(splitPathname[2].trim().length == 0) {
            throw new Error(`Expecting url.pathname to specify either '/camera/_all' or /camera/camera1,camera2... but got '${splitPathname[2]}'`);
        }

        this._logger.debug(`Creating (or getting from the cache) UnifiNVR for url '${url}'`);
        let unifiNvr = this.getOrCreateUnifiNvr(url.host, url.username, url.password);

        this._logger.debug(`Processing requested cameras`);

        const cameras = [];
        const requestedCameras = splitPathname[2];
        this._logger.debug(`Requested cameras: '${requestedCameras}'`);

        if(requestedCameras == "_all") {
            for(let camera of unifiNvr.cameras) {
                cameras.push({
                    id: camera.id,
                    name: camera.name
                });
            }
        } else {
            const requestedCamerasList: string[] = requestedCameras.split(',').map(val => val.trim());
            for(let requestedCamera of requestedCamerasList) {
                let camera = unifiNvr.cameras.filter((val) => requestedCameras == val.name);
                if(camera.length == 1) {
                    cameras.push({
                        id: camera[0].id,
                        name: camera[0].name
                    });
                } else {
                    this._logger.error(`Cannot find camera named '${requestedCamera}' in UnifiNVR at '${unifiNvr.host}'`);
                    throw new Error(`Camera '${requestedCamera}' not found`);
                }
            }
        }

        this._logger.debug(`Found '${cameras.length}' cameras: '${cameras.map((val) => val.name)}'`);
        this._logger.info(`Creating '${cameras.length}' Streams`);

        let result = [];
        for(let camera of cameras) {
            this._logger.debug(`Creating Stream to handle camera: '${camera.name}'`);

            let unifiStream = context.createUnifiStreamController(camera.name, camera.id, this, unifiNvr);
            this._unifiStreamsById.set(unifiStream.id, unifiStream);
            result.push(unifiStream);
        }

        return result;
    }

    private getOrCreateUnifiNvr(host, username, password): UnifiNvr {
        const key = `${username}:${host}`
        let unifiNvr = this._unifiNvrsById.get(key);
        if(unifiNvr == undefined) {
            unifiNvr = context.createUnifiNvr(host, username, password);
            this._unifiNvrsById.set(key, unifiNvr);
        }

        return unifiNvr;
    }
}

export class UnifiStreamController implements IStreamController {
    private _logger = context.createChildLogger(UnifiStreamController.name);
    private readonly _unifiCameraName;
    private readonly _unifiCameraId;
    private readonly _unifiStreamProvider;
    private readonly _unifiNvr;
    private _codec: string;
    private _container: string;
    private _endpoint: string;

    constructor(cameraName: string, cameraId: string, unifiStreamProvider: UnifiStreamProvider, unifiNvr: UnifiNvr) {
        this._unifiCameraName = cameraName;
        this._unifiCameraId = cameraId;
        this._unifiStreamProvider = unifiStreamProvider;
        this._unifiNvr = unifiNvr;

        this._logger.debug(`Stream '${this.id}' created`);
    }

    public get id(): string { return `${this._unifiNvr.host}:${this._unifiCameraName}`; }
    public get codec(): string { return this._codec; }
    public get container(): string { return this._container }
    public get endpoint(): string { return this._endpoint }


    public start() {
        this._logger.debug(`Starting stream controller '${this.id}'...`);
    }

    public wire(ws) {

        let livestream = this._unifiNvr.createLivestream();
        livestream.on("message", (buffer) => {
            ws.send(buffer);
        })

        livestream.start(this._unifiCameraId, 0);

        this._logger.debug(`Connecting to Unifi fMPEG web socket for camera ${this._unifiCameraName}`);
    }

    public stop() {
        this._logger.debug(`Stopping stream '${this.id}'`);
    }

    public dispose() {
        this._logger.debug("Stopped");
    }
}

export class UnifiNvr {
    private _logger = context.createChildLogger(UnifiNvr.name);
    private readonly _host;
    private readonly _username;
    private _password;
    private _protectApi;

    static _unifiProtectModule;
    public constructor(host: string, username: string, password: string) {
        this._host = host;
        this._username = username;
        this._password = password;

        this.initialize();
    }

    public async initialize(): Promise<void> {
        this._logger.debug(`Initializing new ${UnifiNvr.name} instance`);

        // TODO Fix this Jest-induced kludge, it creates a possible race condition
        if(UnifiNvr._unifiProtectModule == undefined) {
            UnifiNvr._unifiProtectModule = await import("unifi-protect");
        }
        this._protectApi = new UnifiNvr._unifiProtectModule.ProtectApi();

        this._logger.info(`Connecting to NVR at '${this._host}' with username '${this._username}'...`)
        if(!(await this._protectApi.login(this._host, this._username, this._password))) {
            throw new Error("Invalid login credentials");
        };

        if(!(await this._protectApi.getBootstrap())) {
            throw new Error("Unable to bootstrap the Protect controller");
        }

        this._logger.info('Connected successfully');
    }

    public get host() { return this._host; };
    public get cameras() { return this._protectApi.bootstrap.cameras; };

    public createLivestream() {
        return this._protectApi.createLivestream();
    }

    public dispose() {
        this._logger.debug("Stopped");
    }
}