# jQuery Lunchbox plugin #

$.lunchbox allows you to quickly build single page applications and reload browser state. 

## Dependencies ##

* jQuery 1.7 (using new .on().off() event API)
* jQuery UI position (optional but recommended)

## Usage ##

Lunchbox allows you to control incoming ajax data, arrange it on the screen (what we call "silos"), and keep state in browser history.

```javascript
$('body').lunchbox('registerListeners', [
  // listen for a get called on /search
  {
    name: ['search|get'],
    silo: 'optional-widget-name-this-appears-on-for-history',
    callback: function(data, text, xhr) {
       // slide elements into place, fade things out, and display the data somewhere:
       $('body').html(data);
    }
  }
]);
```
Just add the class to link or form and lunchbox does the rest:

```html
<a href='/search' class='lunchbox'>Search</a>
```
