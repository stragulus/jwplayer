import { throttle, each } from 'utils/underscore';
import { between } from 'utils/math';
import { style } from 'utils/css';
import { timeFormat } from 'utils/parser';
import { addClass, removeClass, setAttribute, bounds } from 'utils/dom';
import UI, { getPointerType } from 'utils/ui';
import Slider from 'view/controls/components/slider';
import Tooltip from 'view/controls/components/tooltip';
import ChaptersMixin from 'view/controls/components/chapters.mixin';
import CommentsMixin from 'view/controls/components/comments.mixin';
import ThumbnailsMixin from 'view/controls/components/thumbnails.mixin';

class TimeTip extends Tooltip {

    setup() {
        this.author = document.createElement('span');
        this.author.className = 'jw-text jw-comment-author jw-reset';
        this.text = document.createElement('span');
        this.text.className = 'jw-text jw-reset';
        this.img = document.createElement('div');
        this.img.className = 'jw-time-thumb jw-reset';
        this.containerWidth = 0;
        this.textLength = 0;
        this.dragJustReleased = false;
        // is user manually selecting the time tool tip?
        this.showSelectedToolTip = false;

        const wrapper = document.createElement('div');
        wrapper.className = 'jw-time-tip jw-reset';
        wrapper.appendChild(this.img);
        wrapper.appendChild(this.author);
        wrapper.appendChild(this.text);

        this.addContent(wrapper);
    }

    image(styles) {
        style(this.img, styles);
    }

    update(txt, author) {
        this.author.textContent = author || '';
        this.text.textContent = txt;
    }

    getWidth () {
        if (!this.containerWidth) {
            this.setWidth();
        }

        return this.containerWidth;
    }

    setWidth (width) {
        const tolerance = 16; // add a little padding so the tooltip isn't flush against the edge

        if (width) {
            this.containerWidth = width + tolerance;
            return;
        }

        if (!this.container) {
            return;
        }

        this.containerWidth = bounds(this.container).width + tolerance;
    }

    resetWidth () {
        this.containerWidth = 0;
    }
}

function reasonInteraction() {
    return { reason: 'interaction' };
}

class TimeSlider extends Slider {
    constructor(_model, _api) {
        super('jw-slider-time', 'horizontal');

        this._model = _model;
        this._api = _api;

        this.timeTip = new TimeTip('jw-tooltip-time', null, true);
        this.timeTip.setup();

        this.cues = [];
        this.comments = []; // Comment UI elements

        // Store the attempted seek, until the previous one completes
        this.seekThrottled = throttle(this.performSeek, 400);
        this.mobileHoverDistance = 5;

        this.setup();
    }

    // These overwrite Slider methods
    setup() {
        super.setup.apply(this, arguments);

        this._model
            .on('change:duration', this.onDuration, this)
            .on('change:cues', this.addCues, this)
            .on('change:comments', this.setComments, this)
            .on('change:commentsShowUser', this.showCommentNow, this)
            .on('seeked', () => {
                if (!this._model.get('scrubbing')) {
                    this.updateAriaText();
                }
            })
            .change('playlistItem', this.onPlaylistItem, this)
            .change('position', this.onPosition, this)
            .change('buffer', this.onBuffer, this)
            .change('streamType', this.onStreamType, this);


        setAttribute(this.el, 'tabindex', '0');
        setAttribute(this.el, 'role', 'slider');
        setAttribute(this.el, 'aria-label', 'Time Slider');
        this.el.removeAttribute('aria-hidden');
        this.elementRail.appendChild(this.timeTip.element());

        // Show the tooltip on while dragging (touch) moving(mouse), or moving over(mouse)
        this.elementUI = new UI(this.el, { useHover: true, useMove: true })
            .on('drag move over', this.showTimeTooltip, this)
            .on('dragEnd out', this.hideTimeTooltip, this)
            .on('click', () => this.el.focus());

        this.el.addEventListener('focus', () => this.updateAriaText());
    }

    update(percent) {
        this.seekTo = percent;
        this.seekThrottled();
        super.update.apply(this, arguments);
    }

    dragStart() {
        this._model.set('scrubbing', true);
        super.dragStart.apply(this, arguments);
    }

    dragEnd() {
        super.dragEnd.apply(this, arguments);
        this._model.set('scrubbing', false);
    }

    onBuffer(model, pct) {
        this.updateBuffer(pct);
    }

    onPosition(model, position) {
        this.updateTime(position, model.get('duration'));

        if (this.showPopupStartTime) {
            // showing recently added comment popup - overrides all else
            const timeNow = new Date().getTime() / 1000;
            if (timeNow - this.showPopupStartTime > 3) {
                this.disableShowPopupComment();
            }
        } else if (!this.showSelectedToolTip) {
            // no manually selected tool tip or popup comment. Check if there are
            // comments to show as time progresses
            const comment = this.commentAtOffset(position);
            if (comment) {
                const pct = this.calcPct(comment.time, model.get('duration'));
                this.renderTimeToolTip(pct, comment.text, comment.author);
            } else {
                this.disableTimeToolTip();
            }
        }
    }

    onDuration(model, duration) {
        this.updateTime(model.get('position'), duration);
        setAttribute(this.el, 'aria-valuemin', 0);
        setAttribute(this.el, 'aria-valuemax', duration);
        this.drawCues();
        this.drawComments();
    }

    onStreamType(model, streamType) {
        this.streamType = streamType;
    }

    calcPct(position, duration) {
        let pct = 0;
        if (duration) {
            if (this.streamType === 'DVR') {
                const dvrSeekLimit = this._model.get('dvrSeekLimit');
                const diff = duration + dvrSeekLimit;
                const pos = position + dvrSeekLimit;
                pct = (diff - pos) / diff;
            } else if (this.streamType === 'VOD' || !this.streamType) {
                // Default to VOD behavior if streamType isn't set
                pct = position / duration;
            }
        }
        return pct;
    }

    calcTime(duration, pct) {
        let time = duration * pct;

        // For DVR we need to swap it around
        if (duration < 0) {
            const dvrSeekLimit = this._model.get('dvrSeekLimit');
            duration += dvrSeekLimit;
            time = (duration * pct);
            time = duration - time;
        }
        return time;
    }

    updateTime(position, duration) {
        const pct = this.calcPct(position, duration) * 100;
        this.render(pct);
    }

    onPlaylistItem(model, playlistItem) {
        if (!playlistItem) {
            return;
        }
        this.reset();
        // setting the model comments to an empty list will trigger a change:comments
        // event which in turn will trigger a redraw of the comments
        // TODO: Should I be accessing the model from the view like this if so much
        //       effort is taken in giving it underscores? This needs to be handled
        //       in the model itself, as does loading comments from tracks (which is
        //       the reason this needs to be here to begin with)
        this._model._model.setComments([]); 
        this.addCues(model, model.get('cues'));

        const tracks = playlistItem.tracks;
        each(tracks, function (track) {
            if (track && track.kind && track.kind.toLowerCase() === 'thumbnails') {
                this.loadThumbnails(track.file);
            } else if (track && track.kind && track.kind.toLowerCase() === 'chapters') {
                this.loadChapters(track.file);
            } else if (track && track.kind && track.kind.toLowerCase() === 'comments') {
                this.loadComments(track.file);
            }
        }, this);
    }

    performSeek() {
        const percent = this.seekTo;
        const duration = this._model.get('duration');
        let position;
        if (duration === 0) {
            this._api.play(reasonInteraction());
        } else if (this.streamType === 'DVR') {
            const seekRange = this._model.get('seekRange');
            const dvrSeekLimit = this._model.get('dvrSeekLimit');
            position = seekRange.start + (-duration - dvrSeekLimit) * percent / 100;
            this._api.seek(position, reasonInteraction());
        } else {
            position = percent / 100 * duration;
            this._api.seek(Math.min(position, duration - 0.25), reasonInteraction());
        }
    }

    showTimeTooltip(evt) {
        let duration = this._model.get('duration');
        if (duration === 0) {
            return;
        }

        // already displaying a comment
        if (this.showPopupStartTime) {
            return;
        }

        const railBounds = bounds(this.elementRail);
        let position = (evt.pageX ? (evt.pageX - railBounds.left) : evt.x);
        position = between(position, 0, railBounds.width);
        const pct = position / railBounds.width;
        const time = this.calcTime(duration, pct);

        let timetipText;
        let author;

        // With touch events, we never will get the hover events on the cues that cause cues to be active.
        // Therefore use the info we about the scroll position to detect if there is a nearby cue to be active.
        // TODO: also support comments
        if (getPointerType(evt.sourceEvent) === 'touch') {
            this.activeCue = this.cues.reduce((closeCue, cue) => {
                if (Math.abs(position - (parseInt(cue.pct) / 100 * railBounds.width)) < this.mobileHoverDistance) {
                    return cue;
                }
                return closeCue;
            }, undefined);
        }

        if (this.activeCue) {
            timetipText = this.activeCue.text;
        } else if (this.activeComment) {
            author = this.activeComment.author;
            timetipText = this.activeComment.text;
        } else {
            const allowNegativeTime = true;
            timetipText = timeFormat(time, allowNegativeTime);

            // If DVR and within live buffer
            if (duration < 0 && time > -1) {
                timetipText = 'Live';
            }
        }

        this.renderTimeToolTip(pct, timetipText, author);
        this.showSelectedToolTip = true;
    }

    renderTimeToolTip(pct, timetipText, author) {
        const timeTip = this.timeTip;
        const railBounds = bounds(this.elementRail);
        const playerWidth = this._model.get('containerWidth');
        const time = this.calcTime(this._model.get('duration'), pct);

        timeTip.update(timetipText, author);
        if (this.textLength !== timetipText.length) {
            // An activeCue or activeComment may cause the width of the timeTip container to change
            this.textLength = timetipText.length;
            timeTip.resetWidth();
        }
        this.showThumbnail(time);

        const timeTipWidth = timeTip.getWidth();
        const widthPct = railBounds.width / 100;
        const tolerance = playerWidth - railBounds.width;
        let timeTipPct = 0;
        if (timeTipWidth > tolerance) {
            // timeTip may go outside the bounds of the player. Determine the % of tolerance needed
            timeTipPct = (timeTipWidth - tolerance) / (2 * 100 * widthPct);
        }
        const safePct = Math.min(1 - timeTipPct, Math.max(timeTipPct, pct)).toFixed(3) * 100;
        style(timeTip.el, { left: safePct + '%' });
        
        this.enableTimeToolTip();
    }

    hideTimeTooltip() {
        this.disableTimeToolTip();
        this.showSelectedToolTip = false;
    }

    enableTimeToolTip() {
        // start displaying the tool tip
        addClass(this.timeTip.el, 'jw-open');
    }

    disableTimeToolTip() {
        // stop displaying the tool tip
        removeClass(this.timeTip.el, 'jw-open');
    }

    addCues(model, cues) {
        this.resetChapters();
        if (cues && cues.length) {
            cues.forEach((ele) => {
                this.addCue(ele);
            });
            this.drawCues();
        }
    }

    setComments(model, comments) {
        // triggered whenever comments are set or added to the model. It will 
        // clear all comment views and recreate a new set
        // TODO: would be nice if comments could be *added* without destroying
        // all the divs
        this.resetComments();
        if (comments && comments.length) {
            comments.forEach((ele) => {
                this.addComment(ele);
            });
            this.drawComments();
        }
    }

    showCommentNow(model, commentToShow) {
        if (commentToShow) {
            // disable manually selected tooltip
            if (this.showSelectedToolTip) {
                this.showSelectedToolTip = false;
                this.hideTimeTooltip();
            }

            if (this.showPopupStartTime) {
                // TODO need to do anything?
            }
            this.showPopupStartTime = new Date().getTime() / 1000;

            // assume we want to show the last added comment
            const pct = this.calcPct(commentToShow.video_position, model.get('duration'));
            this.renderTimeToolTip(pct, commentToShow.message, commentToShow.author);
            this._model.set('commentsShowUser', false);
        }
    }

    disableShowPopupComment() {
        this.disableTimeToolTip(); 
        this.showPopupStartTime = undefined;
    }

    updateAriaText() {
        const position = this._model.get('position');
        const duration = this._model.get('duration');
        let ariaText;

        if (this.streamType === 'DVR') {
            ariaText = timeFormat(position);
        } else {
            ariaText = `${timeFormat(position)} of ${timeFormat(duration)}`;
        }
        setAttribute(this.el, 'aria-valuetext', ariaText);
    }

    reset() {
        this.resetThumbnails();
        this.resetComments();
        this.timeTip.resetWidth();
        this.textLength = 0;
        this.showPopupStartTime = undefined;
    }
}

Object.assign(TimeSlider.prototype, ChaptersMixin, CommentsMixin, ThumbnailsMixin);

export default TimeSlider;
