import * as shell from "shelljs";
import {ProtectApi, ProtectLivestream, ProtectNvrBootstrap} from "unifi-protect";
import * as util from "node:util";
import {
    CommandLineAction,
    CommandLineChoiceParameter,
    CommandLineFlagParameter,
    CommandLineParser
} from "@rushstack/ts-command-line";

class BusinessLogic {
   static doTheWork(force: boolean, protocol: string) {
        console.log(force);
        console.log(protocol);
    }

    static configureLogger(value: string) {
       console.log(value);
    };
}

export class PushAction extends CommandLineAction {
    private _force: CommandLineFlagParameter;
    private _protocol: CommandLineChoiceParameter;

    public constructor() {
        super({
            actionName: 'push',
            summary: 'Pushes a widget to the service',
            documentation: 'Here we provide a longer description of how our action works.'
        });

        this._force = this.defineFlagParameter({
            parameterLongName: '--force',
            parameterShortName: '-f',
            description: 'Push and overwrite any existing state'
        });

        this._protocol = this.defineChoiceParameter({
            parameterLongName: '--protocol',
            description: 'Specify the protocol to use',
            alternatives: ['ftp', 'webdav', 'scp'],
            environmentVariable: 'WIDGET_PROTOCOL',
            defaultValue: 'scp'
        });
    }

    protected async onExecute(): Promise<void> { // abstract
        await BusinessLogic.doTheWork(this._force.value, this._protocol.value || "(none)");
    }
}

export class WidgetCommandLine extends CommandLineParser {
    private _verbose: CommandLineFlagParameter;

    public constructor() {
        super({
            toolFilename: 'widget',
            toolDescription: 'The "widget" tool is a code sample for using the @rushstack/ts-command-line library.'
        });

        this.addAction(new PushAction());

        this._verbose = this.defineFlagParameter({
            parameterLongName: '--verbose',
            parameterShortName: '-v',
            description: 'Show extra logging detail'
        });
    }

    protected async onExecute(): Promise<void> { // override
        BusinessLogic.configureLogger(this._verbose.value);
        await super.onExecute();
    }
}

const commandLine: WidgetCommandLine = new WidgetCommandLine();
commandLine.executeAsync();

process.exit(0);

const USERID = 'viewport-1';
const PASSWORD = shell.exec('security find-generic-password -l dev-user -a unifi-protect -w', {silent: true}).split('\n')[0];

async function login(ufp: ProtectApi) {
    // Set a listener to wait for the bootstrap event to occur.
    ufp.once("bootstrap", (bootstrapJSON: ProtectNvrBootstrap) => {

        // Once we've bootstrapped the Protect controller, output the bootstrap JSON and we're done.
        // process.stdout.write(util.inspect(bootstrapJSON, {
        //     colors: true,
        //     depth: null,
        //     sorted: true
        // }) + "\n", () => process.exit(0));
        //console.log("Logged in");
    });

    // Login to the Protect controller.
    if (!(await ufp.login("192.168.4.10", USERID, PASSWORD))) {

        console.log("Invalid login credentials.");
        process.exit(0);
    }
    ;

    // Bootstrap the controller. It will emit a message once it's received the bootstrap JSON, or you can alternatively wait for the promise to resolve.
    if (!(await ufp.getBootstrap())) {

        console.log("Unable to bootstrap the Protect controller.");
        process.exit(0);
    }
}

// Create a new Protect API instance.
const ufp = new ProtectApi();
login(ufp);

const pls = ufp.createLivestream();
pls.on("close", () => {
    console.log("close");
    process.exit(0);
})

pls.on("codec", (codec) => {
    //console.log(codec);
})

pls.on("initsegment", (buffer) => {
    //console.log(buffer);
})

pls.on("message", (buffer) => {
    process.stdout.write(buffer);
})

pls.on("segment", (buffer) => {
    //console.log(buffer);
})

pls.start("667b554f024e4603e400041b", 0);