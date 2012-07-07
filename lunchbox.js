/**
 * lunchbox.js
 * Copyright (c) 2012 InGrid Solutions
 * Created by Andrew Ettinger (with special thanks to Nick Sinopoli)
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

(function($, window) {

    var history = window.History
      , allListeners = {}
			, listenerBackup= {}
      , allSilos = {}
      , currentSilos = {
          bb: 'null',
          date: 'null',
          sb: 'null'
        }
      , quarantine = []
      , updateFromHistory = true
      , settings;

    var methods = {
      init: function(options) {
        settings = $.extend( {
          'apply_to': '.lunchbox'
        }, options);
        methods.loadLunchboxState(true);
        methods._bindEvents();
        methods.setLunchboxData();
        return this;
      },

      _bindEvents: function() {
        history.Adapter.bind(window, 'statechange', function() {
          if ( updateFromHistory ) {
            methods.loadLunchboxState();
          }
        });

        $.subscribe('params/clear', function(e, paramsToClear) {
          methods.clearParamsFromQueryString(paramsToClear);
        });

        $.subscribe('quarantine/uri', function(e, uri) {
          methods.quarantineUri(uri);
        });

        $.subscribe('silos/update', function(e, silos, pushState) {
          methods.updateSilos(silos);
          if ( pushState ) {
            methods.pushState();
          }
        });

        $.subscribe('silo/reload', function(e, silo) {
          methods.reloadSilo(silo);
        });

        $('body').on('click', 'a' + settings.apply_to, function() {
          methods.setLunchboxData();
          methods.boxitup(this);
          return false;
        });

        $('body').on('change', 'input' + settings.apply_to, function() {
          methods.setLunchboxData();
          methods.boxitup(this);
          return false;
        });

        $('body').on('click', 'input' + settings.apply_to + '[type="button"]', function() {
          methods.setLunchboxData();
          methods.boxitup(this);
          return false;
        });

        $('body').on('submit', 'form' + settings.apply_to, function() {
          methods.setLunchboxData();
          methods.boxitup(this);
          return false;
        });
      },

      boxitup: function(element) {
        var successCallback = function(data, text, xhr, pushState) {

          var callbackAttr = $(element).attr('data-lunchbox-callback')
            , callbacks = allListeners[callbackAttr] || []
            , linkAttr = $(element).attr('data-lunchbox-link');

          $.each(callbacks, function(index, callback) {
            var silos;

            callback(data, text, xhr);

            if ( pushState ) {
              silos = methods._parseSilo(allSilos[callbackAttr][index], linkAttr);
              methods.updateSilos(silos);
              methods.pushState();
            }
          });
        };

        var failureCallback = function(data, text, xhr) {
          // TODO: do something here!
        };

        switch(methods.getMethod(element)) {
          case 'get' :
            var url = methods.getUrl(element),
                cliData = methods.getData(element);
            $.read(url, cliData, function(data, text, xhr) {
              successCallback(data, text, xhr, true);
            }, failureCallback);
            break;
          case 'delete' :
            $.destroy(methods.getUrl(element), methods.getData(element), successCallback, failureCallback);
            break;
          case 'post' :
            $.create(methods.getUrl(element), methods.getData(element), successCallback, failureCallback);
            break;
          case 'put' :
            $.update(methods.getUrl(element), methods.getData(element), successCallback, failureCallback);
            break;
        }
      },

      clearParamsFromQueryString: function(paramsToClear) {
        methods.pushState(paramsToClear);
      },

      convertCallbackToUri: function(callback) {
        var components = callback.split('|');
        return '/' + components.slice(0, -1).join('/');
      },

      formatUri: function(uri, method) {
        // remove any get params:
        uri = uri.split('?')[0];
        return uri.substring(1).replace(/\//g, '|') + '|' + method;
      },

      getCallback: function(o) {
        return methods.getLink(o).replace(/\|\d+/g, '');
      },

      getChangedSilos: function(siloUri) {
        var changed = [];
        $.each(currentSilos, function(silo, val) {
          var query = methods._getQueryStringParameter(silo, siloUri) || 'null';
          if ( query !== val ) {
            changed.push({silo: silo, val: query});
          }
        });
        return changed;
      },

      getCurrentSilos: function() {
        var final = [];
        $.each(currentSilos, function(silo, val) {
          if ( val ) {
            final.push({silo: silo, val: val});
          }
        });
        return final;
      },

      getData: function(o) {
        if ($(o).attr('action')) {
            return $(o).serialize();
        }
        // TODO: be smarter here: should we have a data-lunchbox-data for anchors?
        return {};
      },

      // link includes the id:
      //      users|82|edit|get
      //  this is used to keep state via History
      getLink: function(o) {
        if ( !methods.getUrl(o) ) {
          throw "No URL provided for lunchbox in " + $(o).attr('id') + "/" + $(o).attr('class');
        } else {
          return methods.formatUri(methods.getUrl(o), methods.getMethod(o));
        }
      },

      getMethod: function(o) {
        var m;

        // we have a form!
        if ( $(o).attr('action') ) {
          m = $(o).find('input[name=_method]').val() || $(o).attr('method');
          return m;

        // we have an anchor!
        } else if ( $(o).attr('href') ) {
          m = $(o).attr('data-method') || 'get';
          return m;
        }
      },

      getNonSilos: function() {
        var uriParams = {},
            match,
            // Regex for replacing addition symbol with a space
            pl     = /\+/g,
            search = /([^&=]+)=?([^&]*)/g,
            decode = function(s) {
              return decodeURIComponent(s.replace(pl, ' '));
            },
            query  = window.location.search.substring(1);

        while ( match = search.exec(query) ) {
          uriParams[decode(match[1])] = decode(match[2]);
        }

        $.each(currentSilos, function(key, val) {
          delete uriParams[key];
        });

        return uriParams;
      },

      _getQueryStringParameter: function(name, uri) {
        uri = uri || window.location.search;
        var match = RegExp('[?&]' + name + '=([^&]*)')
          .exec(uri);
        return match && decodeURIComponent(match[1].replace(/\+/g, ' '));
      },

      getUrl: function(o) {
        var url;
        if ( url = $(o).attr('action') ) {
          return url;
        }

        if ( url = $(o).attr('href') ) {
          return url;
        }

        // experimental for other non-traditional elements:
        if ( url = $(o).attr('data-lunchbox-href') ) {
          return url;
        }
      },

      loadLunchboxState: function(forceReload) {
        $(function() {
          var state = history.getState().data
            , siloUri = ( forceReload ) ? '' : state.uri
            , changedSilos = methods.getChangedSilos(siloUri);

          $.each(changedSilos, function(index, silo) {
            var name, callbacks, uri;

            if ( ~$.inArray(silo.val, quarantine) ) {
              // continue
              return true;
            }

            name = silo.val.replace(/\|\d+/g, '');
            callbacks = allListeners[name];
            uri = methods.convertCallbackToUri(silo.val);

            if ( silo.silo === 'date' ) {
              $.publish('silo/date/change', [silo.val, forceReload]);
              // continue
              return true;
            }

            if ( name === 'null' ) {
              $.publish('silo/change/null', [silo.silo]);
            }

            if ( callbacks ) {
              $.each(callbacks, function(index, callback) {
                $.read(uri, {}, function(data, text, xhr) {
                  callback(data, text, xhr);
                });
              });
            }
          });

          methods.updateSilos(changedSilos);
          if ( forceReload ) {
            methods.pushState();
          }
        });
      },

      quarantineUri: function(uri) {
        quarantine.push(uri);
      },

      _parseSilo: function(silo, defaultCallback) {
        var final = [], parts;

        if ( !~silo.indexOf('=') ) {
          return [{silo: silo, val: defaultCallback}];
        }

        if ( ~silo.indexOf('&') ) {
          parts = silo.split('&');

          $.each(parts, function(index, part) {
            var components = part.split('=');
            final.push({silo: components[0], val: components[1]});
          });
          return final;
        }

        parts = silo.split('=');
        return [{silo: parts[0], val: parts[1]}];
      },

      pushState: function(ignoreParams) {
        var silos = methods.getCurrentSilos()
          , queryString = '?';

        ignoreParams = ignoreParams || [];

        $.each(silos, function(index, silo) {
          if ( silo.val !== 'null' && !~$.inArray(silo.silo, ignoreParams) ) {
            queryString += silo.silo + '=' + silo.val + '&';
          }
        });

        $.each(methods.getNonSilos(), function(param, val) {
          if ( !~$.inArray(param, ignoreParams) ) {
            queryString += param + '=' + val + '&';
          }
        });

        if ( queryString.length > 1 ) {
          queryString = queryString.slice(0, -1);
        }

        updateFromHistory = false;
        history.pushState({uri: queryString}, "", queryString);
        updateFromHistory = true;
      },

      register: function(listeners) {
        methods.registerListeners(listeners);
      },

      registerListeners: function(listeners) {
        $.each(listeners, function(listenerIndex, listener) {
          $.each(listener.name, function(nameIndex, name) {

            if ( allListeners[name] ) {
              allListeners[name].push(listener.callback);
            } else {
              allListeners[name] = [listener.callback];
            }

            if ( allSilos[name] ) {
              allSilos[name].push(listener.silo);
            } else {
              allSilos[name] = [listener.silo];
            }

          });
        });
      },

      reloadSilo: function(silo) {
        var name = methods._getQueryStringParameter(silo)
          , callbacks = allListeners[name.replace(/\|\d+/g, '')]
          , uri = methods.convertCallbackToUri(name);

          if ( callbacks ) {
            $.each(callbacks, function(index, callback) {
              $.read(uri, {}, function(data, text, xhr) {
                callback(data, text, xhr);
              });
            });
          }
      },

      restore: function(targets) {
        $.each(targets, function(targetIndex, targetName) {
          if ( listenerBackup[targetName] ) {
            allListeners[targetName] = listenerBackup[targetName];
          }
        });
      },

      setLunchboxData: function() {
        $('.lunchbox').each(function() {
          $(this).attr('data-lunchbox-link', methods.getLink(this));

          $(this).attr('data-lunchbox-callback', methods.getCallback(this));
        });
      },

      stash: function(targets) {
        $.each(targets, function(targetIndex, targetName) {
          if ( allListeners[targetName] ) {
            var tmp = allListeners[targetName];
            allListeners[targetName] = [];
            listenerBackup[targetName] = tmp;
          }
        });
      },

      unregister: function(targets) {
        $.each(targets, function(targetIndex, targetName) {
          if ( allListeners[targetName] ) {
            allListeners[targetName] = [];
          }
        });
      },

      updateSilos: function(silos) {
        $.each(silos, function(index, silo) {
          currentSilos[silo.silo] = silo.val;
        });
      }

    };

    $.fn.lunchbox = function(method) {
      if ( methods[method] ) {
        return methods[method].apply(this, Array.prototype.slice.call(arguments, 1));
      } else if ( typeof method === 'object' || !method ) {
        return methods.init.apply(this, arguments);
      }
    };

})(jQuery, window);
