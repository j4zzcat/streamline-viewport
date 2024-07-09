import {Logger} from "../utils/logger";
import {UnifiVideoProvider} from "./unifi";
import {RTSPVideoProvider} from "./rtsp";
import {GridLayoutManager} from "./layout";
import {PluginRegistry} from "../utils/plugin";

export interface IVideoProvider {
    canHandle(url: URL): boolean
    getOrCreateStreams(url: URL): Promise<IStream[]>
};

export interface IStream {
    get id(): string;
    get codec(): string;
    get container(): string;
    get endpoint(): string;

    start();
    stop();
}

export interface ILayoutManager {
}

export class Backend {
    private _logger = Logger.createLogger(Backend.name);
    private _videoProvidersRegistry: PluginRegistry;
    private _layoutManagersRegistry: PluginRegistry;

    public constructor() {
        this._logger.debug('Filling plugin registries...');

        this._videoProvidersRegistry = new PluginRegistry()
            .addPlugin(new UnifiVideoProvider())
            .addPlugin(new RTSPVideoProvider());

        this._layoutManagersRegistry = new PluginRegistry()
            .addPlugin(new GridLayoutManager());
    }

    public async handleStreamAction(layout: string, sUrls: readonly string[]): Promise<void> {
        this._logger.debug(`Handling stream action`);
        for(let sUrl of sUrls) {
            let url;

            try {
                url = new URL(sUrl);
            } catch(e) {
                this._logger.error(e);
                throw new Error(`Failed to process stream url, got '${e}'`);
            }

            Logger.addRedaction(url.password);
            this._logger.debug(`Processing stream url '${sUrl}'`);

            let streamsManager = this._videoProvidersRegistry.getPlugin(url);
            let streams = await streamsManager.getOrCreateStreams(url);
            streams.forEach((stream) => {
                stream.start();
                this._logger.info(`Started stream '${stream.id}', codec is '${stream.codec}', container is '${stream.container}' endpoint is '${stream.endpoint}'`)
            });
        }
    }
}

