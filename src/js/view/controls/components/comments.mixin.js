import { ajax } from 'utils/ajax';

class CommentCue {
    constructor (time, message, author) {
        this.time = time;
        this.author = author;
        this.text = message;
        this.el = document.createElement('div');
        this.el.className = 'jw-comment jw-reset';
    }

    align(duration) {
        // If a percentage, use it, else calculate the percentage
        if (this.time.toString().slice(-1) === '%') {
            this.pct = this.time;
        } else {
            const percentage = (this.time / duration) * 100;
            this.pct = percentage + '%';
        }

        this.el.style.left = this.pct;
    }
}

const CommentsMixin = {

    loadComments: function (file) {
        ajax(file, this.commentsLoaded.bind(this), this.commentsFailed, {
            plainText: true
        });
    },

    commentsLoaded: function (evt) {
        const data = JSON.parse(evt.responseText);
        if (Array.isArray(data.comments)) {
            // set all comments at once. Will trigger a change:comments events which
            // will trigger the redraw.
            // TODO: model model
            this._model._model.setComments(data.comments);
        }
    },

    commentsFailed: function () {},

    addComment: function (obj) {
        // add new comment popup to existing list
        this.comments.push(new CommentCue(obj.video_position, obj.message, obj.author));
    },

    drawComments: function () {
        // We won't want to draw them until we have a duration
        const duration = this._model.get('duration');
        if (!duration || duration <= 0) {
            return;
        }

        this.comments.forEach((comment) => {
            comment.align(duration);
            comment.el.addEventListener('mouseover', () => {
                this.activeComment = comment;
            });
            comment.el.addEventListener('mouseout', () => {
                this.activeComment = null;
            });
            this.elementRail.appendChild(comment.el);
        });
    },

    commentAtOffset: function(duration) {
        // TODO: actually implement
        if (duration >= 19 && duration < 22 && this.comments.length) {
            return this.comments[0];
        }
    },

    resetComments: function() {
        // clears comment popups
        this.comments.forEach((comment) => {
            if (comment.el.parentNode) {
                comment.el.parentNode.removeChild(comment.el);
            }
        });
    }
};

export default CommentsMixin;

