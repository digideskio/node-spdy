'use strict';

var thing = require('handle-thing');
var httpDeceiver = require('http-deceiver');
var util = require('util');

function Handle(stream, socket) {
  var state = {};
  this._spdyState = state;

  state.stream = stream;
  state.socket = null;
  state.rawSocket = socket || stream.connection.socket;
  state.deceiver = null;

  var self = this;
  thing.call(this, stream, {
    getPeerName: function() {
      return self._getPeerName();
    },
    close: function(callback) {
      return self._close(callback);
    }
  });

  if (!state.stream) {
    this.on('stream', function(stream) {
      state.stream = stream;
    });
  }
}
util.inherits(Handle, thing);
module.exports = Handle;

Handle.create = function create(stream, socket) {
  return new Handle(stream, socket);
};

Handle.prototype._getPeerName = function _getPeerName() {
  var state = this._spdyState;

  if (state.rawSocket._getpeername)
    return state.rawSocket._getpeername();

  return null;
};

Handle.prototype._close = function _close(callback) {
  var state = this._spdyState;

  state.stream.abort(callback);
};

Handle.prototype._getStream = function _getStream(callback) {
  var state = this._spdyState;

  if (state.stream) {
    process.nextTick(function() {
      callback(state.stream);
    });
    return;
  }

  this.on('stream', callback);
};

Handle.prototype.assignSocket = function assignSocket(socket, options) {
  var state = this._spdyState;

  state.socket = socket;
  state.deceiver = httpDeceiver.create(socket, options);

  function onStreamError(err) {
    state.socket.emit('error', err);
  }

  this._getStream(function(stream) {
    stream.on('error', onStreamError);
  });
};

Handle.prototype.assignClientRequest = function assignClientRequest(req) {
  var state = this._spdyState;
  var oldSend = req._send;

  // Catch the headers before request will be sent
  var self = this;
  req._send = function send() {
    var headers = this._headers;
    this._headerSent = true;

    // To prevent exception
    this.connection = state.socket;

    self._getStream(function(stream) {
      stream.sendHeaders(headers);
    });

    req._send = oldSend;
    return req._send.apply(this, arguments);
  };

  // No chunked encoding
  req.useChunkedEncodingByDefault = false;

  req.on('finish', function() {
    req.socket.end();
  });
};

Handle.prototype.assignRequest = function assignRequest(req) {
  // Emit trailing headers
  this._getStream(function(stream) {
    stream.on('headers', function(headers) {
      req.emit('trailers', headers);
    });
  });
};

Handle.prototype.assignResponse = function assignResponse(res) {
  var self = this;

  res.addTrailers = function addTrailers(headers) {
    self._getStream(function(stream) {
      stream.sendHeaders(headers);
    });
  };
};

Handle.prototype.emitRequest = function emitRequest() {
  var state = this._spdyState;
  var stream = state.stream;

  state.deceiver.emitRequest({
    method: stream.method,
    path: stream.path,
    headers: stream.headers
  });
};

Handle.prototype.emitResponse = function emitResponse(status, headers) {
  var state = this._spdyState;

  state.deceiver.emitResponse({
    status: status,
    headers: headers
  });
};