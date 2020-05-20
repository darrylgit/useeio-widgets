import { DemandType, ResultPerspective } from "./webapi";
import * as strings from "./strings";

/**
 * A common configuration object of our widgets. Often our widgets take
 * the same configuration options regarding the data they present (e.g.
 * the codes of industry sectors or indicators).
 */
export interface Config {

    /**
     * The possible sender of an configuration update.
     */
    source?: any;

    /**
     * The ID of the input output model
     */
    model?: string;

    /**
     * An array of sector codes.
     */
    sectors?: string[];

    /**
     * An array of indicator codes.
     */
    indicators?: string[];

    /**
     * The result perspective.
     */
    perspective?: ResultPerspective;

    /**
     * The type of the demand vector.
     */
    analysis?: DemandType;

    /**
     * The year of the demand vector.
     */
    year?: number;

    /**
     * An optional location code to filter sectors
     * by location in multi-regional models.
     */
    location?: string;
}

export abstract class Widget {

    private isReady = false;
    private listeners = new Array<(config: Config) => void>();
    private queue = new Array<() => void>();

    update(config: Config) {
        if (!config || config.source === this) {
            return;
        }
        if (!this.isReady) {
            this.queue.push(() => this.handleUpdate(config));
        } else {
            this.handleUpdate(config);
        }
    }

    protected ready() {
        this.isReady = true;
        if (this.queue.length === 0) {
            return;
        }
        const fn = this.queue.pop();
        fn();
    }

    onChanged(fn: (config: Config) => void) {
        this.listeners.push(fn);
    }

    protected fireChange(config: Config) {
        config.source = this;
        for (const fn of this.listeners) {
            fn(config);
        }
    }

    protected async handleUpdate(_: Config) {
    }
}

export interface ConfigTransmitter {

    join(widget: Widget): void;

    update(config: Config): void;
}

export class UrlConfigTransmitter implements ConfigTransmitter {

    private widgets = new Array<Widget>();
    private config: Config = {};

    constructor() {
        this.config = parseUrlConfig({ withScripts: true });
        window.onhashchange = () => this.onHashChanged();
        window.addEventListener("popstate", () => this.onHashChanged());
    }

    /**
     * Returns the current configuration of this transmitter.
     */
    public get(): Config {
        return { ...this.config };
    }

    /**
     * Updates the configation of this transmitter if the given object contains
     * properties that are not already defined. Only if there is at least one
     * such property, an update is fired.
     */
    public updateIfAbsent(conf: Record<string, any>) {
        if (!conf) return;
        const next: Record<string, any> = { ...this.config };
        let needsUpdate = false;
        for (const key of Object.keys(conf)) {
            if (!next[key]) {
                next[key] = conf[key];
                needsUpdate = true;
            }
        }
        if (needsUpdate) {
            this.update(next as Config);
        }
    }

    private onHashChanged() {
        this.config = {
            ...this.config,
            ...parseUrlConfig(),
        };
        for (const widget of this.widgets) {
            widget.update(this.config);
        }
    }

    clearAll() {
        window.location.hash = "";
    }

    join(widget: Widget) {
        this.widgets.push(widget);
        widget.update(this.config);
        widget.onChanged((config) => {
            this.config = {
                ...this.config,
                ...config,
            };
            this.config.source = widget;
            this.updateHash();
        });
    }

    update(config: Config) {
        this.config = {
            ...this.config,
            ...config,
        };
        this.config.source = this;
        this.updateHash();
    }

    private updateHash() {
        const parts = new Array<string>();
        const conf = this.config;
        if (conf.sectors && conf.sectors.length > 0) {
            parts.push("sectors=" + conf.sectors.join(","));
        }
        if (conf.indicators && conf.indicators.length > 0) {
            parts.push("indicators=" + conf.indicators.join(","));
        }
        [
            ["type", conf.analysis],
            ["perspective", conf.perspective],
            ["year", conf.year],
            ["location", conf.location],
            ["model", conf.model],
        ].forEach(([key, val]) => {
            if (val) {
                parts.push(`${key}=${val}`);
            }
        });
        window.location.hash = "#" + parts.join("&");
    }
}

/**
 * Parses the URL configuration from the browser URL (window.location)
 * and optionally also from the URLs of included JavaScript files. Hash
 * parameters have a higher priority than normal URL parameters; the
 * browser URL has a higher priority that the URLs of included JavaScript
 * files.
 */
function parseUrlConfig(what?: { withScripts?: boolean }): Config {
    const config: Config = {};
    const urls: string[] = [
        window.location.href,
    ];
    if (what && what.withScripts) {
        const scriptTags = document.getElementsByTagName("script");
        for (let i = 0; i < scriptTags.length; i++) {
            const url = scriptTags[i].src;
            if (url) {
                urls.push(url);
            }
        }
    }
    for (const url of urls) {
        const hashParams = getParameters(getHashPart(url));
        const otherParams = getParameters(getParameterPart(url));
        updateConfig(config, hashParams);
        updateConfig(config, otherParams);
    }
    return config;
}

/**
 * Updates the given configuration with the given URL parameters if and only
 * if the respective parameters are not already defined in that configuration.
 */
function updateConfig(config: Config, urlParams: [string, string][]) {
    for (const [key, val] of urlParams) {
        switch (key) {

            case "model":
                if (config.model)
                    break;
                config.model = val;
                break;

            case "sectors":
                if (config.sectors)
                    break;
                config.sectors = val.split(",");
                break;

            case "indicators":
                if (config.indicators)
                    break;
                config.indicators = val.split(",");
                break;

            case "type":
            case "analysis":
                if (config.analysis)
                    break;
                if (strings.eq(val, "consumption")) {
                    config.analysis = "Consumption";
                } else if (strings.eq(val, "production")) {
                    config.analysis = "Production";
                }
                break;

            case "perspective":
                if (config.perspective)
                    break;
                const p = getPerspective(val);
                if (p) {
                    config.perspective = p;
                }
                break;

            case "location":
                if (config.location)
                    break;
                config.location = val;
                break;

            case "year":
                if (config.year)
                    break;
                try {
                    config.year = parseInt(val, 10);
                } catch (e) {
                    delete config.year;
                }

            default:
                break;
        }
    }
}

/**
 * Try to determine the result perspecitve from the value in the URL hash.
 */
function getPerspective(val: string): ResultPerspective | null {
    if (!val) {
        return null;
    }
    switch (val.trim().toLowerCase()) {
        case "direct":
        case "direct results":
        case "supply":
        case "supply chain":
            return "direct";
        case "final":
        case "final results":
        case "consumption":
        case "final consumption":
        case "point of consumption":
            return "final";
        case "intermediate":
        case "intermediate results":
            return "intermediate";
        default:
            return null;
    }
}

function getParameters(urlPart: string): [string, string][] {
    if (!urlPart)
        return [];
    const pairs = urlPart.split("&");
    const params: [string, string][] = [];
    for (const pair of pairs) {
        const keyVal = pair.split("=");
        if (keyVal.length < 2) {
            continue;
        }
        const key = keyVal[0].trim().toLowerCase();
        const val = keyVal[1].trim();
        params.push([key, val]);
    }
    return params;
}

function getHashPart(url: string): string | null {
    if (!url)
        return null;
    const parts = url.split("#");
    return parts.length < 2
        ? null
        : parts[parts.length - 1];
}

function getParameterPart(url: string): string | null {
    if (!url)
        return null;
    let part = url;

    // remove the hash part
    let parts = url.split("#");
    if (parts.length > 1) {
        part = parts[parts.length - 2];
    }

    // get the parameter part
    parts = part.split("?");
    return parts.length < 2
        ? null
        : parts[1];
}