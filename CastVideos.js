// Copyright 2014 Google Inc. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


(function() {
  'use strict';

/**
 * Width of progress bar in pixel
 **/
var PROGRESS_BAR_WIDTH = 600;

/**
 * Constatns of states for Chromecast device 
 **/
var DEVICE_STATE = {
  'IDLE' : 0, 
  'ACTIVE' : 1, 
  'WARNING' : 2, 
  'ERROR' : 3,
};

/**
 * Constatns of states for CastPlayer 
 **/
var PLAYER_STATE = {
  'IDLE' : 'IDLE', 
  'LOADING' : 'LOADING', 
  'LOADED' : 'LOADED', 
  'PLAYING' : 'PLAYING',
  'PAUSED' : 'PAUSED',
  'STOPPED' : 'STOPPED',
  'SEEKING' : 'SEEKING',
  'ERROR' : 'ERROR'
};

/**
 * Cast player object
 * main variables:
 *  - deviceState for Cast mode: 
 *    IDLE: Default state indicating that Cast extension is installed, but showing no current activity
 *    ACTIVE: Shown when Chrome has one or more local activities running on a receiver
 *    WARNING: Shown when the device is actively being used, but when one or more issues have occurred
 *    ERROR: Should not normally occur, but shown when there is a failure 
 *  - Cast player variables for controlling Cast mode media playback 
 *  - Local player variables for controlling local mode media playbacks
 *  - Current media variables for transition between Cast afnd local modes
 */
var CastPlayer = function() {
  /* device variables */
  // @type {DEVICE_STATE} A state for device
  this.deviceState = DEVICE_STATE.IDLE;

  /* Cast player variables */
  // @type {Object} a chrome.cast.media.Media object
  this.currentMediaSession = null;
  // @type {Number} volume
  this.currentVolume = 0.5;
  // @type {Boolean} A flag for autoplay after load
  this.autoplay = true;
  // @type {string} a chrome.cast.Session object
  this.session = null;
  // @type {PLAYER_STATE} A state for Cast media player
  this.castPlayerState = PLAYER_STATE.IDLE;

  /* Local player variables */
  // @type {PLAYER_STATE} A state for local media player
  this.localPlayerState = PLAYER_STATE.PAUSED;
  // @type {HTMLElement} local player
  this.localPlayer = null;

  /* Current media variables */
  // @type {Boolean} Audio on and off
  this.audio = true;
  // @type {Number} A number for current media index
  this.currentMediaIndex = 0;
  // @type {Number} A number for current media time
  this.currentMediaTime = 0;
  // @type {Number} A number for current media duration
  this.currentMediaDuration = -1;
  // @type {Timer} A timer for tracking progress of media
  this.timer = null;
  // @type {Boolean} A boolean to stop timer update of progress when triggered by media status event 
  this.progressFlag = true;
  // @type {Number} A number in milliseconds for minimal progress update
  this.timerStep = 1000;

  this.initializeCastPlayer();
  this.initializeLocalPlayer();
};

/**
 * Initialize local media player 
 */
CastPlayer.prototype.initializeLocalPlayer = function() {
  this.localPlayer = document.getElementById('video_element')
};

/**
 * Initialize Cast media player 
 * Initializes the API. Note that either successCallback and errorCallback will be
 * invoked once the API has finished initialization. The sessionListener and 
 * receiverListener may be invoked at any time afterwards, and possibly more than once. 
 */
CastPlayer.prototype.initializeCastPlayer = function() {

  if (!chrome.cast || !chrome.cast.isAvailable) {
    setTimeout(this.initializeCastPlayer.bind(this), 1000);
    return;
  }
  // default set to the default media receiver app ID
  // optional: you may change it to point to your own
  // var applicationID = chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID;
  var applicationID = "33015E37";

  // request session
  var sessionRequest = new chrome.cast.SessionRequest(applicationID);
  var apiConfig = new chrome.cast.ApiConfig(sessionRequest,
    this.sessionListener.bind(this),
    this.receiverListener.bind(this));

  chrome.cast.initialize(apiConfig, this.onInitSuccess.bind(this), this.onError.bind(this));
  this.initializeUI();
};

/**
 * Callback function for init success 
 */
CastPlayer.prototype.onInitSuccess = function() {
  //console.log("init success");
  this.updateMediaControlUI();
};

/**
 * Generic error callback function 
 */
CastPlayer.prototype.onError = function() {
  //error
};

/**
 * @param {!Object} e A new session
 * This handles auto-join when a page is reloaded
 * When active session is detected, playback will automatically
 * join existing session and occur in Cast mode and media
 * status gets synced up with current media of the session 
 */
CastPlayer.prototype.sessionListener = function(e) {
  this.session = e;
  if( this.session ) {
    this.deviceState = DEVICE_STATE.ACTIVE;
    if( this.session.media[0] ) {
      this.onMediaDiscovered('activeSession', this.session.media[0]);
    }
    else {
      this.loadMedia(this.currentMediaIndex);
    }
  }
}

/**
 * @param {string} e Receiver availability
 * This indicates availability of receivers but
 * does not provide a list of device IDs
 */
CastPlayer.prototype.receiverListener = function(e) {
  if( e === 'available' ) {
    //console.log("receiver found");
  }
  else {
    //console.log("receiver list empty");
  }
};


/**
 * Requests that a receiver application session be created or joined. By default, the SessionRequest
 * passed to the API at initialization time is used; this may be overridden by passing a different
 * session request in opt_sessionRequest. 
 */
CastPlayer.prototype.launchApp = function() {
  //console.log("launching app...");
  chrome.cast.requestSession(this.onRequestSessionSuccess.bind(this), this.onLaunchError.bind(this));
  if( this.timer ) {
    clearInterval(this.timer);
  }
};

/**
 * Callback function for request session success 
 * @param {Object} e A chrome.cast.Session object
 */
CastPlayer.prototype.onRequestSessionSuccess = function(e) {
  //console.log("session success: " + e.sessionId);
  this.session = e;
  this.deviceState = DEVICE_STATE.ACTIVE;
  this.updateMediaControlUI();
  this.loadMedia(this.currentMediaIndex);
};

/**
 * Callback function for launch error
 */
CastPlayer.prototype.onLaunchError = function() {
  //console.log("launch error");
  this.deviceState = DEVICE_STATE.ERROR;
};

/**
 * Stops the running receiver application associated with the session.
 */
CastPlayer.prototype.stopApp = function() {
  if (this.session) {
    this.session.stop(this.onStopAppSuccess.bind(this, 'Session stopped'), this.onError.bind(this));    
  }
};

/**
 * Callback function for stop app success 
 */
CastPlayer.prototype.onStopAppSuccess = function(message) {
  //console.log(message);
  this.deviceState = DEVICE_STATE.IDLE;
  this.castPlayerState = PLAYER_STATE.IDLE;
  this.currentMediaSession = null;
  clearInterval(this.timer);
  this.updateDisplayMessage();
  this.updateMediaControlUI();
};

/**
 * Loads media into a running receiver application
 * @param {Number} mediaIndex An index number to indicate current media content
 */
CastPlayer.prototype.loadMedia = function(mediaIndex) {
  if (!this.session) {
    //console.log("no session");
    return;
  }
  //console.log("loading...");
  var mediaInfo = new chrome.cast.media.MediaInfo(video_link);
  var ext = video_link.split('.').pop();
  var exts = ['mkv','webm','mp4','jpeg','jpg','gif','png','bmp','webp'];
  var is_valid = exts.indexOf(ext);
  if (is_valid > 0) {
    mediaInfo.contentType = getContentType(video_link);
  } else {
    mediaInfo.contentType = 'video/mp4';
  }
  mediaInfo.metadata = new chrome.cast.media.MovieMediaMetadata({metadata: 0});
  mediaInfo.metadata.images = [{'url': 'http://getpopcornti.me/images/bye.jpg'}];
  mediaInfo.metadata.metadataType = 0;
  mediaInfo.metadata.subtitle = video_link;
  mediaInfo.metadata.title = 'PopcornCast';
  var request = new chrome.cast.media.LoadRequest(mediaInfo);
  request.autoplay = this.autoplay;
  if( this.localPlayerState == PLAYER_STATE.PLAYING ) {
    request.currentTime = this.localPlayer.currentTime;
  }
  else {
    request.currentTime = 0;
  } 

 var payload = {
    "title:" : 'PopcornCast',
    "thumb" : 'http://getpopcornti.me/images/bye.jpg'
  };

  // specify the closed captioning tracks
  var json = {
    "payload" : payload,
        cc: {
      tracks: [{
        src: 'legenda.vtt'
      }],
      active: 0
    }
  };

  request.customData = json;

  this.castPlayerState = PLAYER_STATE.LOADING;
  this.session.loadMedia(request,
    this.onMediaDiscovered.bind(this, 'loadMedia'),
    this.onLoadMediaError.bind(this));

};

/**
 * Callback function for loadMedia success
 * @param {Object} mediaSession A new media object.
 */
CastPlayer.prototype.onMediaDiscovered = function(how, mediaSession) {
  //console.log("new media session ID:" + mediaSession.mediaSessionId + ' (' + how + ')');
  this.currentMediaSession = mediaSession;
  if( how == 'loadMedia' ) {
    if( this.autoplay ) {
      this.castPlayerState = PLAYER_STATE.PLAYING;
    }
    else {
      this.castPlayerState = PLAYER_STATE.LOADED;
    }
  }

  if( how == 'activeSession' ) {
    this.castPlayerState = this.session.media[0].playerState; 
    this.currentMediaTime = this.session.media[0].currentTime; 
  }

  if( this.castPlayerState == PLAYER_STATE.PLAYING ) {
    // start progress timer
    this.startProgressTimer(this.incrementMediaTime);
  }

  this.currentMediaSession.addUpdateListener(this.onMediaStatusUpdate.bind(this));

  this.currentMediaDuration = this.currentMediaSession.media.duration;
  var duration = this.currentMediaDuration;
  var hr = parseInt(duration/3600);
  duration -= hr * 3600;
  var min = parseInt(duration/60);
  var sec = parseInt(duration % 60);
  if ( hr > 0 ) {
    duration = hr + ":" + min + ":" + leftPad(sec,2);
  }
  else {
    if( min > 0 ) {
      duration = min + ":" + leftPad(sec,2);
    }
    else {
      leftPad(sec,2)
    }
  }
  document.getElementById("duration").innerHTML = duration;

  this.localPlayerState == PLAYER_STATE.STOPPED;
  // start progress timer
  this.startProgressTimer(this.incrementMediaTime);

  // update UIs
  this.updateMediaControlUI();
  this.updateDisplayMessage();
};

/**
 * Callback function when media load returns error 
 */
CastPlayer.prototype.onLoadMediaError = function(e) {
  //console.log(e);
  this.castPlayerState = PLAYER_STATE.IDLE;
  // update UIs
  this.updateMediaControlUI();
  this.updateDisplayMessage();

  document.getElementById("playerstate").style.display = 'block';
  document.getElementById("playerstatebg").style.display = 'block';
  document.getElementById("playerstate").innerHTML = "<span class='loaded'>Error...could not load file</span><span class='vid_link'><a href='"+video_link+"'>"+video_link+"</a></span>";

};

/**
 * Callback function for media status update from receiver
 * @param {!Boolean} e true/false
 */
CastPlayer.prototype.onMediaStatusUpdate = function(e) {
  if( e == false ) {
    this.currentMediaTime = 0;
    this.castPlayerState = PLAYER_STATE.IDLE;
  }
  //console.log("updating media");
  this.updateProgressBar(e);
  this.updateDisplayMessage();
  this.updateMediaControlUI();
};

/**
 * Helper function
 * Increment media current position by 1 second 
 */
CastPlayer.prototype.incrementMediaTime = function() {
  if( this.castPlayerState == PLAYER_STATE.PLAYING || this.localPlayerState == PLAYER_STATE.PLAYING ) {
    if( this.currentMediaTime < this.currentMediaDuration ) {
      this.currentMediaTime += 1;
      this.updateProgressBarByTimer();
    }
    else {
      this.currentMediaTime = 0;
      clearInterval(this.timer);
    }
  }
};



/**
 * Callback when media is loaded in local player 
 * @param {Number} currentTime A number for media current position 
 */
CastPlayer.prototype.onMediaLoadedLocally = function(currentTime) {
  this.currentMediaDuration = this.localPlayer.duration;
  var duration = this.currentMediaDuration;
      
  var hr = parseInt(duration/3600);
  duration -= hr * 3600;
  var min = parseInt(duration/60);
  var sec = parseInt(duration % 60);
  if ( hr > 0 ) {
    duration = hr + ":" + min + ":" + leftPad(sec,2);
  }
  else {
    if( min > 0 ) {
      duration = min + ":" + leftPad(sec,2);
    }
    else {
      duration = leftPad(sec,2);
    }
  }
  document.getElementById("duration").innerHTML = duration;
  this.localPlayer.currentTime= currentTime;
  // start progress timer
  this.startProgressTimer(this.incrementMediaTime);

  document.getElementById("playerstate").style.display = 'block';
  document.getElementById("playerstatebg").style.display = 'block';
  document.getElementById("playerstate").innerHTML = "<span class='loaded'>Loaded...now push play!</span><span class='vid_link'><a href='"+video_link+"'>"+video_link+"</a></span>";

};

/**
 * Play media in Cast mode 
 */
CastPlayer.prototype.playMedia = function() {
  switch( this.castPlayerState ) 
  {
    case PLAYER_STATE.LOADED:
    case PLAYER_STATE.PAUSED:
      this.currentMediaSession.play(null, 
        this.mediaCommandSuccessCallback.bind(this,"playing started for " + this.currentMediaSession.sessionId),
        this.onError.bind(this));
      if (this.currentMediaSession) {
        this.currentMediaSession.addUpdateListener(this.onMediaStatusUpdate.bind(this));
      }
      this.castPlayerState = PLAYER_STATE.PLAYING;
      // start progress timer
      this.startProgressTimer(this.incrementMediaTime);
      break;
    case PLAYER_STATE.IDLE:
    case PLAYER_STATE.LOADING:
    case PLAYER_STATE.STOPPED:
      this.loadMedia(this.currentMediaIndex);
      if (this.currentMediaSession) {
        this.currentMediaSession.addUpdateListener(this.onMediaStatusUpdate.bind(this));
      }
      this.castPlayerState = PLAYER_STATE.PLAYING;
      break;
    default:
      break;
  }
  this.updateMediaControlUI();
  this.updateDisplayMessage();
};

/**
 * Pause media playback in Cast mode  
 */
CastPlayer.prototype.pauseMedia = function() {
  if( !this.currentMediaSession ) {
    this.pauseMediaLocally();
    return;
  }

  if( this.castPlayerState == PLAYER_STATE.PLAYING ) {
    this.castPlayerState = PLAYER_STATE.PAUSED;
    this.currentMediaSession.pause(null,
      this.mediaCommandSuccessCallback.bind(this,"paused " + this.currentMediaSession.sessionId),
      this.onError.bind(this));
    this.updateMediaControlUI();
    this.updateDisplayMessage();
    clearInterval(this.timer);
  }
};

/**
 * Pause media playback in local player 
 */
CastPlayer.prototype.pauseMediaLocally = function() {
  this.localPlayer.pause();
  this.localPlayerState = PLAYER_STATE.PAUSED;
  this.updateMediaControlUI();
  clearInterval(this.timer);
};

/**
 * Stop meia playback in either Cast or local mode  
 */
CastPlayer.prototype.stopMedia = function() {
  if( !this.currentMediaSession ) {
    this.stopMediaLocally();
    return;
  }

  this.currentMediaSession.stop(null,
    this.mediaCommandSuccessCallback.bind(this,"stopped " + this.currentMediaSession.sessionId),
    this.onError.bind(this));
  this.castPlayerState = PLAYER_STATE.STOPPED;
  clearInterval(this.timer);

  this.updateDisplayMessage();
  this.updateMediaControlUI();
};

/**
 * Stop media playback in local player
 */
CastPlayer.prototype.stopMediaLocally = function() {
  this.localPlayer.style.display = 'none';
  this.localPlayer.stop();
  this.localPlayerState = PLAYER_STATE.STOPPED;
  this.updateMediaControlUI();
};

/**
 * Set media volume in Cast mode
 * @param {Boolean} mute A boolean  
 */
CastPlayer.prototype.setMediaVolume = function(mute) {
  var p = document.getElementById("audio_bg_level"); 
  if( event.currentTarget.id == 'audio_bg_track' ) {
    var pos = 100 - parseInt(event.offsetY);
  }
  else {
    var pos = parseInt(p.clientHeight) - parseInt(event.offsetY);
  }
  if( !this.currentMediaSession ) {
      this.localPlayer.volume = pos < 100 ? pos/100 : 1;
      p.style.height = pos + 'px';
      p.style.marginTop = -pos + 'px';
      return;
  }

  if( event.currentTarget.id == 'audio_bg_track' || event.currentTarget.id == 'audio_bg_level' ) {
    // add a drag to avoid loud volume
    if( pos < 100 ) {
      var vScale = this.currentVolume * 100;
      if( pos > vScale ) {
        pos = vScale + (pos - vScale)/2;
      }
      p.style.height = pos + 'px';
      p.style.marginTop = -pos + 'px';
      this.currentVolume = pos/100;
    }
    else {
      this.currentVolume = 1;
    }
  }

  var volume = new chrome.cast.Volume();
  volume.level = this.currentVolume;
  volume.muted = mute;
  var request = new chrome.cast.media.VolumeRequest();
  request.volume = volume;
  this.currentMediaSession.setVolume(request,
    this.mediaCommandSuccessCallback.bind(this),
    this.onError.bind(this));
  this.updateMediaControlUI();
};

/**
 * Mute media function in either Cast or local mode 
 */
CastPlayer.prototype.muteMedia = function() {
  if( this.audio == true ) {
    this.audio = false;
    document.getElementById('audio_on').style.display = 'none';
    document.getElementById('audio_off').style.display = 'block';
    if( this.currentMediaSession ) {
      this.setMediaVolume(true);
    }
    else {
      this.localPlayer.muted = true;
    }
  }
  else {
    this.audio = true;
    document.getElementById('audio_on').style.display = 'block';
    document.getElementById('audio_off').style.display = 'none';
    if( this.currentMediaSession ) {
      this.setMediaVolume(false);
    }
    else {
      this.localPlayer.muted = false;
    }
  } 
  this.updateMediaControlUI();
};


/**
 * media seek function in either Cast or local mode
 * @param {Event} e An event object from seek 
 */
CastPlayer.prototype.seekMedia = function(event) {
  var pos = parseInt(event.offsetX);
  var pi = document.getElementById("progress_indicator"); 
  var p = document.getElementById("progress"); 
  if( event.currentTarget.id == 'progress_indicator' ) {
    var curr = parseInt(this.currentMediaTime + this.currentMediaDuration * pos / PROGRESS_BAR_WIDTH);
    var pp = parseInt(pi.style.marginLeft) + pos;
    var pw = parseInt(p.style.width) + pos;
  }
  else {
    var curr = parseInt(pos * this.currentMediaDuration / PROGRESS_BAR_WIDTH);
    var pp = pos -21 - PROGRESS_BAR_WIDTH;
    var pw = pos;
  }

  if( this.castPlayerState != PLAYER_STATE.PLAYING && this.castPlayerState != PLAYER_STATE.PAUSED ) {
    return;
  }

  this.currentMediaTime = curr;
  //console.log('Seeking ' + this.currentMediaSession.sessionId + ':' + this.currentMediaSession.mediaSessionId + ' to ' + pos + "%");
  var request = new chrome.cast.media.SeekRequest();
  request.currentTime = this.currentMediaTime;
  this.currentMediaSession.seek(request,
    this.onSeekSuccess.bind(this, 'media seek done'),
    this.onError.bind(this));
  this.castPlayerState = PLAYER_STATE.SEEKING;

  this.updateDisplayMessage();
  this.updateMediaControlUI();
};

/**
 * Callback function for seek success
 * @param {String} info A string that describe seek event
 */
CastPlayer.prototype.onSeekSuccess = function(info) {
  //console.log(info);
  this.castPlayerState = PLAYER_STATE.PLAYING;
  this.updateDisplayMessage();
  this.updateMediaControlUI();
};

/**
 * Callback function for media command success 
 */
CastPlayer.prototype.mediaCommandSuccessCallback = function(info, e) {
  //console.log(info);
};

/**
 * Update progress bar when there is a media status update
 * @param {Object} e An media status update object 
 */
CastPlayer.prototype.updateProgressBar = function(e) {
  var p = document.getElementById("progress"); 
  var pi = document.getElementById("progress_indicator"); 
  if(e.idleReason == 'FINISHED' && e.playerState == 'IDLE' ) {
    p.style.width = '0px';
    pi.style.marginLeft = -21 - PROGRESS_BAR_WIDTH + 'px';
    clearInterval(this.timer);
    this.castPlayerState = PLAYER_STATE.STOPPED;
    this.updateDisplayMessage();
  }
  else {
    var width = Math.ceil(PROGRESS_BAR_WIDTH * e.currentTime / this.currentMediaSession.media.duration + 1);
    if (width > 600) { width = 600; }
    p.style.width = width + 'px';
    this.progressFlag = false; 
    setTimeout(this.setProgressFlag.bind(this),1000); // don't update progress in 1 second
    var pp = Math.ceil(PROGRESS_BAR_WIDTH * e.currentTime / this.currentMediaSession.media.duration);
    pi.style.marginLeft = -21 - PROGRESS_BAR_WIDTH + pp + 'px';
  }
};

/**
 * Set progressFlag with a timeout of 1 second to avoid UI update
 * until a media status update from receiver 
 */
CastPlayer.prototype.setProgressFlag = function() {
  this.progressFlag = true;
};

/**
 * Update progress bar based on timer  
 */
CastPlayer.prototype.updateProgressBarByTimer = function() {
  var p = document.getElementById("progress"); 
  if( isNaN(parseInt(p.style.width)) ) {
    p.style.width = 0;
  } 
  if( this.currentMediaDuration > 0 ) {
    var pp = Math.floor(PROGRESS_BAR_WIDTH * this.currentMediaTime/this.currentMediaDuration);
  }
    
  if( this.progressFlag ) { 
    // don't update progress if it's been updated on media status update event
    if (pp > 600) { pp = 600; }
    p.style.width = pp + 'px'; 
    var pi = document.getElementById("progress_indicator"); 
    pi.style.marginLeft = -21 - PROGRESS_BAR_WIDTH + pp + 'px';
  }

  if( pp > PROGRESS_BAR_WIDTH ) {
    clearInterval(this.timer);
    this.deviceState = DEVICE_STATE.IDLE;
    this.castPlayerState = PLAYER_STATE.IDLE;
    this.updateDisplayMessage();
    this.updateMediaControlUI();
  }
};

/**
 * Update display message depending on cast mode by deviceState 
 */
CastPlayer.prototype.updateDisplayMessage = function() {

  document.getElementById("playerstate").style.display = 'block';
  document.getElementById("playerstatebg").style.display = 'block';

  if (this.session != null) {
    document.getElementById("playerstate").innerHTML = this.castPlayerState
      + " on " + this.session.receiver.friendlyName;
  } else {
    document.getElementById("playerstate").innerHTML = "Start casting to begin";
    this.launchApp();
  }

}

/**
 * Update media control UI components based on localPlayerState or castPlayerState
 */
CastPlayer.prototype.updateMediaControlUI = function() {
  if( this.deviceState == DEVICE_STATE.ACTIVE ) {
    document.getElementById("casticonactive").style.display = 'block';
    document.getElementById("casticonidle").style.display = 'none';
    var playerState = this.castPlayerState;
  }
  else {
    document.getElementById("casticonidle").style.display = 'block';
    document.getElementById("casticonactive").style.display = 'none';
    var playerState = this.localPlayerState;
  }

  switch( playerState ) 
  {
    case PLAYER_STATE.LOADED:
    case PLAYER_STATE.PLAYING:
      document.getElementById("play").style.display = 'none';
      document.getElementById("pause").style.display = 'block';
      break;
    case PLAYER_STATE.PAUSED:
    case PLAYER_STATE.IDLE:
    case PLAYER_STATE.LOADING:
    case PLAYER_STATE.STOPPED:
      document.getElementById("play").style.display = 'block';
      document.getElementById("pause").style.display = 'none';
      break;
    default:
      break;
  }
}

/**
 * Initialize UI components and add event listeners 
 */
CastPlayer.prototype.initializeUI = function() {

  // add event handlers to UI components
  document.getElementById("casticonidle").addEventListener('click', this.launchApp.bind(this));
  document.getElementById("casticonactive").addEventListener('click', this.stopApp.bind(this));
  document.getElementById("progress_bg").addEventListener('click', this.seekMedia.bind(this));
  document.getElementById("progress").addEventListener('click', this.seekMedia.bind(this));
  document.getElementById("progress_indicator").addEventListener('dragend', this.seekMedia.bind(this));
  document.getElementById("audio_on").addEventListener('click', this.muteMedia.bind(this));
  document.getElementById("audio_off").addEventListener('click', this.muteMedia.bind(this));
  document.getElementById("audio_bg").addEventListener('mouseover', this.showVolumeSlider.bind(this));
  document.getElementById("audio_on").addEventListener('mouseover', this.showVolumeSlider.bind(this));
  document.getElementById("audio_bg_level").addEventListener('mouseover', this.showVolumeSlider.bind(this));
  document.getElementById("audio_bg_track").addEventListener('mouseover', this.showVolumeSlider.bind(this));
  document.getElementById("audio_bg_level").addEventListener('click', this.setMediaVolume.bind(this, false));
  document.getElementById("audio_bg_track").addEventListener('click', this.setMediaVolume.bind(this, false));
  document.getElementById("audio_bg").addEventListener('mouseout', this.hideVolumeSlider.bind(this));
  document.getElementById("audio_on").addEventListener('mouseout', this.hideVolumeSlider.bind(this));

  // enable play/pause buttons
  document.getElementById("play").addEventListener('click', this.playMedia.bind(this));
  document.getElementById("pause").addEventListener('click', this.pauseMedia.bind(this));
  document.getElementById("progress_indicator").draggable = true;

};

/**
 * Show the volume slider
 */
CastPlayer.prototype.showVolumeSlider = function() {
  document.getElementById('audio_bg').style.opacity = 1;
  document.getElementById('audio_bg_track').style.opacity = 1;
  document.getElementById('audio_bg_level').style.opacity = 1;
  document.getElementById('audio_indicator').style.opacity = 1;
};    

/**
 * Hide the volume stlider 
 */
CastPlayer.prototype.hideVolumeSlider = function() {
  document.getElementById('audio_bg').style.opacity = 0;
  document.getElementById('audio_bg_track').style.opacity = 0;
  document.getElementById('audio_bg_level').style.opacity = 0;
  document.getElementById('audio_indicator').style.opacity = 0;
};    

/**
 * @param {function} A callback function for the fucntion to start timer 
 */
CastPlayer.prototype.startProgressTimer = function(callback) {
  if( this.timer ) {
    clearInterval(this.timer);
    this.timer = null;
  }

  // start progress timer
  this.timer = setInterval(callback.bind(this), this.timerStep);
};

 window.CastPlayer = CastPlayer;
})();


function getContentType(url) {
  var ext = url.split('.').pop();
  var formats = [
    {ext: 'mkv', type: 'video'},
    {ext: 'webm', type: 'video'},
    {ext: 'mp4', type: 'video'},
    {ext: 'jpeg', type: 'image'},
    {ext: 'jpg', type: 'image'},
    {ext: 'gif', type: 'image'},
    {ext: 'png', type: 'image'},
    {ext: 'bmp', type: 'image'},
    {ext: 'webp', type: 'image'}
  ];
  for (var i = 0; i < formats.length; i++) {
    if (formats[i].ext == ext) {
      return formats[i].type + "/" + ext;
    }
  }
  // it doesn't matter now, as it's unsupported.
  return "";
}

function leftPad(number, targetLength) {
    var output = number + '';
    while (output.length < targetLength) {
        output = '0' + output;
    }
    return output;
}

/**
 * set the closed captioning track
 * @param {string} trackNumber the closed captioning track number
 */
function setCaptions(trackNumber) {
  if (this.session!=null) {
        if (trackNumber == undefined) {
      message = {
        type: 'DISABLE_CC'
      }
    } else {
      message = {
        type: 'ENABLE_CC',
        trackNumber: trackNumber
      }
    }
    this.session.sendMessage('urn:x-cast:com.google.cast.sample.closecaption', message, onSuccess, onError);
  }     else {
    alert("First connect to a Cast device.");
  }
};

/**
 * set the closed captioning font size
 * @param {string} size the closed captioning size index
 */
function setFont(number) {
  if (this.session!=null) {
        if (number == 0) {
      message = {
        type: 'NORMAL_FONT'
      }
    } else {
      message = {
        type: 'YELLOW_FONT'
      }
    }
    this.session.sendMessage('urn:x-cast:com.google.cast.sample.closecaption', message, onSuccess, onError);
  }     else {
    alert("First connect to a Cast device.");
  }
};


document.addEventListener('DOMContentLoaded',function(){ 
  document.getElementById("the_bookmarklet").onclick = function (e) {e.preventDefault();alert("Drag this to your bookmarks bar and click it on other pages!")};
})
