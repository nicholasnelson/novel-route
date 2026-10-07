/**
 * Generates the Leaflet map HTML that runs inside a WebView.
 *
 * Interim renderer: this is being replaced by Mapbox (docs/maps.md). Until then,
 * colours are computed on the React Native side and sent with each marker.
 *
 * The React Native side sends messages to this page (updateMarkers,
 * updateUserPosition, setAutoCenter) and this page posts messages back
 * (markerPress, autoCenterChanged).
 */

export type MapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  fill: string;
  stroke: string;
};

export function buildMapHtml(center: {
  latitude: number;
  longitude: number;
}) {
  return `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>html,body,#map{margin:0;padding:0;width:100%;height:100%}</style>
</head><body>
<div id="map"></div>
<script>
var map = L.map('map').setView([${center.latitude},${center.longitude}], 14);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

var markers = {};
var userMarker = null;
var userCircle = null;
var autoCenter = true;

// Notify RN when user drags the map
map.on('dragstart', function() {
  autoCenter = false;
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'autoCenterChanged', value: false }));
});

function updateUserPosition(lat, lng) {
  var latlng = [lat, lng];
  if (!userMarker) {
    userMarker = L.circleMarker(latlng, {
      radius: 8,
      fillColor: '#4285F4',
      color: '#ffffff',
      weight: 3,
      opacity: 1,
      fillOpacity: 1,
      interactive: false
    }).addTo(map);
    userCircle = L.circle(latlng, {
      radius: 30,
      fillColor: '#4285F4',
      color: '#4285F4',
      weight: 0,
      fillOpacity: 0.15,
      interactive: false
    }).addTo(map);
  } else {
    userMarker.setLatLng(latlng);
    userCircle.setLatLng(latlng);
  }
  userCircle.bringToFront();
  userMarker.bringToFront();
  if (autoCenter) {
    map.setView(latlng, map.getZoom());
  }
}

function setAutoCenter(enabled) {
  autoCenter = enabled;
}

function updateMarkers(list) {
  Object.keys(markers).forEach(function(id) { map.removeLayer(markers[id]); });
  markers = {};

  list.forEach(function(m) {
    var marker = L.circleMarker([m.latitude, m.longitude], {
      radius: 10,
      fillColor: m.fill,
      color: m.stroke,
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(map);
    marker.on('click', function() {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'markerPress', id: m.id }));
    });
    markers[m.id] = marker;
  });
  // Keep the user's position visible above library markers
  if (userCircle) userCircle.bringToFront();
  if (userMarker) userMarker.bringToFront();
}

document.addEventListener('message', function(e) { handleMsg(e); });
window.addEventListener('message', function(e) { handleMsg(e); });
function handleMsg(e) {
  var msg;
  try { msg = JSON.parse(e.data); } catch (err) { return; }
  if (msg.type === 'updateMarkers') {
    updateMarkers(msg.markers);
  } else if (msg.type === 'updateUserPosition') {
    updateUserPosition(msg.lat, msg.lng);
  } else if (msg.type === 'setAutoCenter') {
    setAutoCenter(msg.enabled);
    if (msg.enabled && userMarker) {
      map.setView(userMarker.getLatLng(), map.getZoom());
    }
  }
}
<\/script>
</body></html>`;
}
