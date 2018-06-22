import { OS } from 'environment/environment';
import SimpleModel from 'model/simplemodel';
import { INITIAL_PLAYER_STATE, INITIAL_MEDIA_STATE } from 'model/player-model';
import { STATE_IDLE } from 'events/events';
import { isValidNumber, isNumber } from 'utils/underscore';
import { seconds } from 'utils/strings';
import Providers from 'providers/providers';

// Represents the state of the player
const Model = function() {
    const _this = this;
    let providers;
    let _provider;
    this.mediaModel = new MediaModel();

    this.set('mediaModel', this.mediaModel);

    this.setup = function(config) {
        Object.assign(this.attributes, config, INITIAL_PLAYER_STATE);
        providers = new Providers(this.getConfiguration());
        this.setAutoStart();
        return this;
    };

    this.getConfiguration = function() {
        const config = this.clone();
        const mediaModelAttributes = config.mediaModel.attributes;
        Object.keys(INITIAL_MEDIA_STATE).forEach(key => {
            config[key] = mediaModelAttributes[key];
        });
        config.instreamMode = !!config.instream;
        delete config.instream;
        delete config.mediaModel;
        return config;
    };

    this.persistQualityLevel = function(quality, levels) {
        const currentLevel = levels[quality] || {};
        const { label } = currentLevel;
        // Default to null if bitrate is bad, or when the quality to persist is "auto" (bitrate is undefined in this case)
        const bitrate = isValidNumber(currentLevel.bitrate) ? currentLevel.bitrate : null;
        this.set('bitrateSelection', bitrate);
        this.set('qualityLabel', label);
    };

    this.setActiveItem = function (index) {
        const item = this.get('playlist')[index];
        this.resetItem(item);
        this.attributes.playlistItem = null;
        this.set('item', index);
        this.set('minDvrWindow', item.minDvrWindow);
        this.set('dvrSeekLimit', item.dvrSeekLimit);
        this.set('playlistItem', item);
    };

    this.setMediaModel = function (mediaModel) {
        if (this.mediaModel && this.mediaModel !== mediaModel) {
            this.mediaModel.off();
        }

        mediaModel = mediaModel || new MediaModel();
        this.mediaModel = mediaModel;
        this.set('mediaModel', mediaModel);
        syncPlayerWithMediaModel(mediaModel);
    };

    this.destroy = function() {
        this.attributes._destroyed = true;
        this.off();
        if (_provider) {
            _provider.off(null, null, this);
            _provider.destroy();
        }
    };

    this.getVideo = function() {
        return _provider;
    };

    this.setFullscreen = function(state) {
        state = !!state;
        if (state !== _this.get('fullscreen')) {
            _this.set('fullscreen', state);
        }
    };

    this.getProviders = function() {
        return providers;
    };

    this.setVolume = function(volume) {
        if (!isValidNumber(volume)) {
            return;
        }
        const vol = Math.min(Math.max(0, volume), 100);
        this.set('volume', vol);
        const mute = (vol === 0);
        if (mute !== (this.getMute())) {
            this.setMute(mute);
        }
    };

    this.getMute = function() {
        return this.get('autostartMuted') || this.get('mute');
    };

    this.setMute = function(mute) {
        if (mute === undefined) {
            mute = !(this.getMute());
        }
        this.set('mute', !!mute);
        if (!mute) {
            const volume = Math.max(10, this.get('volume'));
            this.set('autostartMuted', false);
            this.setVolume(volume);
        }
    };

    this.setStreamType = function(streamType) {
        this.set('streamType', streamType);
        if (streamType === 'LIVE') {
            this.setPlaybackRate(1);
        }
    };

    this.setProvider = function (provider) {
        _provider = provider;
        syncProviderProperties(this, provider);
    };

    this.resetProvider = function () {
        _provider = null;
        this.set('provider', undefined);
    };

    this.setPlaybackRate = function(playbackRate) {
        if (!isNumber(playbackRate)) {
            return;
        }

        // Clamp the rate between 0.25x and 4x
        playbackRate = Math.max(Math.min(playbackRate, 4), 0.25);

        if (this.get('streamType') === 'LIVE') {
            playbackRate = 1;
        }

        this.set('defaultPlaybackRate', playbackRate);

        if (_provider && _provider.setPlaybackRate) {
            _provider.setPlaybackRate(playbackRate);
        }
    };

    this.persistCaptionsTrack = function() {
        const track = this.get('captionsTrack');

        if (track) {
            // update preference if an option was selected
            this.set('captionLabel', track.name);
        } else {
            this.set('captionLabel', 'Off');
        }
    };


    this.setVideoSubtitleTrack = function(trackIndex, tracks) {
        this.set('captionsIndex', trackIndex);
        /*
         * Tracks could have changed even if the index hasn't.
         * Need to ensure track has data for captionsrenderer.
         */
        if (trackIndex && tracks && trackIndex <= tracks.length && tracks[trackIndex - 1].data) {
            this.set('captionsTrack', tracks[trackIndex - 1]);
        }
    };

    this.persistVideoSubtitleTrack = function(trackIndex, tracks) {
        this.setVideoSubtitleTrack(trackIndex, tracks);
        this.persistCaptionsTrack();
    };

    // Mobile players always wait to become viewable.
    // Desktop players must have autostart set to viewable
    this.setAutoStart = function(autoStart) {
        if (autoStart !== undefined) {
            this.set('autostart', autoStart);
        }

        const autoStartOnMobile = OS.mobile && this.get('autostart');
        this.set('playOnViewable', autoStartOnMobile || this.get('autostart') === 'viewable');
    };

    this.resetItem = function (item) {
        const position = item ? seconds(item.starttime) : 0;
        const duration = item ? seconds(item.duration) : 0;
        const mediaModel = this.mediaModel;
        this.set('playRejected', false);
        this.attributes.itemMeta = {};
        mediaModel.set('position', position);
        mediaModel.set('currentTime', 0);
        mediaModel.set('duration', duration);
    };

    this.persistBandwidthEstimate = function (bwEstimate) {
        if (!isValidNumber(bwEstimate)) {
            return;
        }
        this.set('bandwidthEstimate', bwEstimate);
    };

    this.addComment = function (comment, showUser) {
        // add a comment to existing comments
        // TODO: not concurrency safe. Should it be?
        // TODO: validate comment
        // Make a copy, as modifying the original will not trigger the change: event
        let comments = Object.assign([], this.get('comments') || []);
        comments.push(comment);
        this.set('comments', comments);
        if (showUser) {
            this.set('commentsShowUser', true);
        }
    };

    this.setComments = function(comments) {
        // set multiple comments at once, replacing any existing comments
        // TODO: validate comments
        this.set('comments', comments);
    };

    this.getComments = function() {
        // TODO: not a deep copy?
        return this.get('comments');
    };
};

const syncProviderProperties = (model, provider) => {
    model.set('provider', provider.getName());
    if (model.get('instreamMode') === true) {
        provider.instreamMode = true;
    }

    if (provider.getName().name.indexOf('flash') === -1) {
        model.set('flashThrottle', undefined);
        model.set('flashBlocked', false);
    }

    // Attempt setting the playback rate to be the user selected value
    model.setPlaybackRate(model.get('defaultPlaybackRate'));

    // Set playbackRate because provider support for playbackRate may have changed and not sent an update
    model.set('supportsPlaybackRate', provider.supportsPlaybackRate);
    model.set('playbackRate', provider.getPlaybackRate());
    model.set('renderCaptionsNatively', provider.renderNatively);
};

function syncPlayerWithMediaModel(mediaModel) {
    // Sync player state with mediaModel state
    const mediaState = mediaModel.get('mediaState');
    mediaModel.trigger('change:mediaState', mediaModel, mediaState, mediaState);
}

// Represents the state of the provider/media element
const MediaModel = Model.MediaModel = function() {
    this.attributes = {
        mediaState: STATE_IDLE
    };
};

Object.assign(MediaModel.prototype, SimpleModel, {
    srcReset() {
        Object.assign(this.attributes, {
            setup: false,
            started: false,
            preloaded: false,
            visualQuality: null,
            buffer: 0,
            currentTime: 0
        });
    }
});

Object.assign(Model.prototype, SimpleModel);

export { MediaModel };
export default Model;
