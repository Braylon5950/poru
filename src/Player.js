const { EventEmitter } = require("events");
const Queue = require("./guild/Queue");
const Filters = require("./guild/Filter")
class Player extends EventEmitter {
    constructor(node, options, manager) {
        super();

        this.manager = manager;

        this.queue = new Queue();

        this.node = node;

        this.filters = new Filters(this, this.node)


        this.guild = options.guild.id || options.guild;

        this.voiceChannel = options.voiceChannel.id || options.voiceChannel;

        this.textChannel = options.textChannel || null;

        this.state = { volume: 100, equalizer: [] };

        this.isConnectd = false;

        this.trackRepeat = false;

        this.queueRepeat = false;

        this.loop = 0;


        this.playing = false;

        this.timestamp = Date.now();

        this.pause = false;
        this.position = 0;



        this.currentTrack = {};

        this.previousTrack = {};


        this.voiceUpdateState = null;



        this.on("event", (data) => (this.lavalinkEvent(data).bind(this))());
        this.on("event", (data) => this.manager.emit("debug", data))
        this.on("playerUpdate", (packet) => {
            this.isConnectd = packet.state.connected,
                this.position = packet.state.position
            this.state = {
                volume: this.state.volume,
                equalizer: this.state.equalizer,
                ...packet.state,

            };
            this.manager.emit("playerUpdate", this, packet);
        });
    }
    async play() {

        if (!this.queue.length) {
            return nulll;
        }
        this.currentTrack = this.queue.shift();
        this.playing = true;
        this.timestamp = Date.now();
        this.node.send({
            op: "play",
            guildId: this.guild,
            track: this.currentTrack.track,
            volume: this.volume || 100,
        });
        this.position = 0;
        return this;
    }


    async stop() {

        this.position = 0;
        this.isConnectd = false
        this.playing = false;
        this.node.send({
            op: "stop",
            guildId: this.guild
        });
        return this;
    }

    pause(pause = true) {
        if (typeof pause !== "boolean") throw new RangeError("Pause function must be pass with boolean value.");

        this.node.send({
            op: "pause",
            guildId: this.guild,
            pause,
        });
        this.playing = !pause;
        this.paused = pause;

        return this;
    }

    async seekTo(position) {
        if (Number.isNaN(position)) throw new RangeError("[Poru Error] Position must be a number.");
        this.position = position;
        this.node.send({
            op: "seek",
            guildId: this.guild,
            position,
        });
        return this;
    }

    async setVolume(volume) {
        if (Number.isNaN(volume)) throw new RangeError("Volume level must be a number.");
        this.volume = volume;
        this.node.send({
            op: "volume",
            guildId: this.guild,
            volume: this.volume,
        });
        return this;

    }

    async TrackRepeat() {
        this.loop = 1;
        this.trackRepeat = true;
        this.queueRepeat = false;
        return this;
    }

    async QueueRepeat() {
        this.loop = 2;
        this.queueRepeat = true;
        this.trackRepeat = false;
        return this;
    }

    async DisableRepeat() {
        this.loop = 0;
        this.trackRepeat = false;
        this.queueRepeat = false;


        return this;
    }

    async setTextChannel(channel) {
        if (typeof channel !== "string") throw new RangeError("Channel must be a string.");
        this.textChannel = channel;
        return this;
    }

    async setVoiceChannel(channel) {
        if (typeof channel !== "string") throw new RangeError("Channel must be a string.");
        this.voiceChannel = channel;
        return this;
    }

    async connect(data) {
        this.voiceUpdateState = data;
        this.node.send({
            op: "voiceUpdate",
            guildId: this.guild,
            ...data,
        });
        return this;
    }

    async reconnect() {
        if (this.voiceChannel === null) return null;
        this.node.send({
            op: 4,
            d: {
                guild_id: this.guild,
                channel_id: this.voiceChannel,
                self_mute: false,
                self_deaf: false,
            },
        });
        return this;
    }




    async disconnect() {
        if (this.voiceChannel === null) return null;
        this.pause(true);
        this.isConnectd = false;
        this.manager.sendWS({
            op: 4,
            d: {
                guild_id: this.guild,
                channel_id: null,
                self_mute: false,
                self_deaf: false,
            },
        });
        this.voiceChannel = null;
        return this;
    }

    destroy() {
        this.disconnect();
        this.node.send({
            op: "destroy",
            guildId: this.guild,
        });
        this.manager.emit("playerDestroy", this);
        this.manager.players.delete(this.guild);
    }

    async autoplay(toggle = false) {

        if (!toggle) return null;
        try {
            if (!this.previousTrack) return this.stop();
            let data = `https://www.youtube.com/watch?v=${this.previousTrack.identifier}&list=RD${this.previousTrack.identifier}`;

            let response = await this.manager.search(data);

            if (!response || !response.tracks || ["LOAD_FAILED", "NO_MATCHES"].includes(response.type)) return this.stop();

            let track = response.tracks[Math.floor(Math.random() * Math.floor(response.tracks.length))];

            this.queue.push(track);

            this.play();

            return this;

        } catch (e) {
            console.log(`[Poru Autoplay] error : ${e}`)
            return this.stop();
        }

    }


    lavalinkEvent(data) {
        const events = {
            TrackStartEvent() {
                this.playing = true;
                this.paused = false;
                this.manager.emit("trackStart", this, this.currentTrack, data);
            },
            // eslint-disable-next-line consistent-return
            TrackEndEvent() {

                this.previousTrack = this.currentTrack;

                if (this.currentTrack && this.loop === 1) {

                    this.queue.unshift(this.previousTrack)
                    return this.play();
                } else if (this.currentTrack && this.loop === 2) {

                    this.queue.push(this.previousTrack)
                    return this.play();
                }

                if (this.queue.length === 0) {
                    return this.manager.emit("queueEnd", this, this.track, data);
                    // this.destroy();
                } else if (this.queue.length > 0) {

                    return this.play();
                }
                this.manager.emit("queueEnd", this, this.track, data);

            },
            TrackStuckEvent() {
                this.queue.shift();
                this.manager.emit("trackError", this, this.track, data);
            },
            TrackExceptionEvent() {
                this.queue.shift();
                /**
                 * Fire up when there's an error while playing the track
                 * @event trackError
                 */
                this.manager.emit("trackError", this, this.track, data);
            },
            WebSocketClosedEvent() {
                if ([4015, 4009].includes(data.code)) {
                    this.manager.sendWS({
                        op: 4,
                        d: {
                            guild_id: data.guildId,
                            channel_id: this.voiceChannel.id || this.voiceChannel,
                            self_mute: this.options.selfMute || false,
                            self_deaf: this.options.selfDeaf || false,
                        },
                    });
                }
                this.manager.emit("socketClosed", this, data);
            },
            default() {
                throw new Error(`An unknown event: ${data}`);
            },
        };
        return events[data.type] || events.default;
    }


}

module.exports = Player;

