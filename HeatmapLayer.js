import React, { useEffect, useRef } from 'react';
import PropTypes from 'prop-types';
import L from 'leaflet';
import { useMap } from 'react-leaflet';
import simpleheat from 'simpleheat';
import { map, reduce, filter, min, max, isNumber } from 'lodash';

function isInvalid(num) {
  return !isNumber(num) && !num;
}

function isValidLatLngArray(arr) {
  return filter(arr, (num) => !isInvalid(num)).length === arr.length;
}

function shouldIgnoreLocation(loc) {
  return isInvalid(loc.lng) || isInvalid(loc.lat);
}

function HeatmapLayer({
  points,
  longitudeExtractor,
  latitudeExtractor,
  intensityExtractor,
  fitBoundsOnLoad,
  fitBoundsOnUpdate,
  onStatsUpdate,
  max: maxProp = 3.0,
  radius = 30,
  maxZoom = 18,
  minOpacity = 0.01,
  blur = 15,
  gradient
}) {
  const leafletMap = useMap();
  const heatmapCanvas = useRef(null);
  const heatmapInstance = useRef(null);

  const safeRemoveLayer = (el) => {
    const { overlayPane } = leafletMap.getPanes();
    if (overlayPane && overlayPane.contains(el)) {
      overlayPane.removeChild(el);
    }
  };

  const fitBounds = () => {
    const lngs = map(points, longitudeExtractor);
    const lats = map(points, latitudeExtractor);
    const ne = { lng: max(lngs), lat: max(lats) };
    const sw = { lng: min(lngs), lat: min(lats) };

    if (!shouldIgnoreLocation(ne) && !shouldIgnoreLocation(sw)) {
      // leafletMap.fitBounds(L.latLngBounds(L.latLng(sw), L.latLng(ne)));
    }
  };

  const attachEvents = () => {
    leafletMap.on('viewreset', reset);
    leafletMap.on('moveend', reset);
    if (leafletMap.options.zoomAnimation && L.Browser.any3d) {
      leafletMap.on('zoomanim', animateZoom);
    }
  };

  const updateHeatmapProps = () => {
    if (heatmapInstance.current) {
      heatmapInstance.current.radius(radius, blur);
      // heatmapInstance.current.gradient(gradient);
      heatmapInstance.current.max(maxProp);
    }
  };

  const animateZoom = (e) => {
    const scale = leafletMap.getZoomScale(e.zoom);
    const offset = leafletMap
      ._getCenterOffset(e.center)
      ._multiplyBy(-scale)
      .subtract(leafletMap._getMapPanePos());

    L.DomUtil.setTransform
      ? L.DomUtil.setTransform(heatmapCanvas.current, offset, scale)
      : heatmapCanvas.current.style[L.DomUtil.TRANSFORM] = `${L.DomUtil.getTranslateString(offset)} scale(${scale})`;
  };

  const reset = () => {
    const topLeft = leafletMap.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(heatmapCanvas.current, topLeft);

    const size = leafletMap.getSize();
    heatmapCanvas.current.width = heatmapInstance.current._width = size.x;
    heatmapCanvas.current.height = heatmapInstance.current._height = size.y;

    redraw();
  };

  const redraw = () => {
    if (!heatmapInstance.current || !points) {
      return;
    }

    heatmapInstance.current.clear();

    const r = heatmapInstance.current._r;
    const size = leafletMap.getSize();
    const v = 1 / Math.pow(2, Math.max(0, Math.min(maxZoom - leafletMap.getZoom(), 12)) / 2);
    const cellSize = r / 2;
    const panePos = leafletMap._getMapPanePos();
    const offsetX = panePos.x % cellSize;
    const offsetY = panePos.y % cellSize;

    const data = reduce(points, (grid, point) => {
      const latLng = [latitudeExtractor(point), longitudeExtractor(point)];
      if (!isValidLatLngArray(latLng)) return grid;

      const p = leafletMap.latLngToContainerPoint(latLng);
      const bounds = new L.Bounds(L.point([-r, -r]), size.add([r, r]));

      if (!bounds.contains(p)) return grid;

      const x = Math.floor((p.x - offsetX) / cellSize) + 2;
      const y = Math.floor((p.y - offsetY) / cellSize) + 2;

      grid[y] = grid[y] || [];
      const cell = grid[y][x];
      const alt = intensityExtractor(point);
      const k = alt * v;

      if (!cell) {
        grid[y][x] = [p.x, p.y, k, 1];
      } else {
        cell[0] = (cell[0] * cell[2] + p.x * k) / (cell[2] + k);
        cell[1] = (cell[1] * cell[2] + p.y * k) / (cell[2] + k);
        cell[2] += k;
        cell[3] += 1;
      }

      return grid;
    }, []);

    const heatmapData = Object.values(data).flatMap(row => 
      row.filter(cell => cell).map(cell => 
        [Math.round(cell[0]), Math.round(cell[1]), Math.min(cell[2], maxProp)]
      )
    );

    heatmapInstance.current.data(heatmapData).draw(minOpacity);
  };

  useEffect(() => {
    const canAnimate = leafletMap.options.zoomAnimation && L.Browser.any3d;
    const zoomClass = `leaflet-zoom-${canAnimate ? 'animated' : 'hide'}`;
    const mapSize = leafletMap.getSize();
    const transformProp = L.DomUtil.testProp(['transformOrigin', 'WebkitTransformOrigin', 'msTransformOrigin']);

    heatmapCanvas.current = L.DomUtil.create('canvas', zoomClass);
    heatmapCanvas.current.style[transformProp] = '50% 50%';
    heatmapCanvas.current.width = mapSize.x;
    heatmapCanvas.current.height = mapSize.y;

    const Heatmap = L.Layer.extend({
      onAdd: () => leafletMap.getPanes().overlayPane.appendChild(heatmapCanvas.current),
      onRemove: () => safeRemoveLayer(heatmapCanvas.current)
    });

    heatmapInstance.current = simpleheat(heatmapCanvas.current);
    const heatmapLayer = new Heatmap();
    leafletMap.addLayer(heatmapLayer);

    fitBoundsOnLoad && fitBounds();
    attachEvents();
    updateHeatmapProps();

    return () => safeRemoveLayer(heatmapCanvas.current);
  }, [leafletMap]);

  useEffect(() => {
    fitBoundsOnUpdate && fitBounds();
    reset();
  }, [points, fitBoundsOnUpdate]);

  useEffect(() => updateHeatmapProps(), [maxProp, radius, maxZoom, minOpacity, blur, gradient]);

  return null;
}

HeatmapLayer.propTypes = {
  points: PropTypes.array.isRequired,
  longitudeExtractor: PropTypes.func.isRequired,
  latitudeExtractor: PropTypes.func.isRequired,
  intensityExtractor: PropTypes.func.isRequired,
  fitBoundsOnLoad: PropTypes.bool,
  fitBoundsOnUpdate: PropTypes.bool,
  onStatsUpdate: PropTypes.func,
  max: PropTypes.number,
  radius: PropTypes.number,
  maxZoom: PropTypes.number,
  minOpacity: PropTypes.number,
  blur: PropTypes.number,
  gradient: PropTypes.object
};

export default HeatmapLayer;
