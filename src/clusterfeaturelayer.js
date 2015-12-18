define([
    'dojo/_base/declare',
    'dojo/_base/array',
    'dojo/_base/lang',
    'dojo/_base/Color',
    'dojo/_base/connect',
    'dojo/on',
    'dojo/promise/all',

    'esri/SpatialReference',
    'esri/geometry/Point',
    'esri/geometry/Polygon',
    'esri/geometry/Multipoint',
    'esri/geometry/Extent',
    'esri/graphic',

    'esri/config',
    'esri/geometry/normalizeUtils',

    'esri/symbols/SimpleMarkerSymbol',
    'esri/symbols/SimpleLineSymbol',
    'esri/symbols/SimpleFillSymbol',
    'esri/symbols/TextSymbol',
    'esri/symbols/Font',

    'esri/renderers/ClassBreaksRenderer',

    'esri/request',
    'esri/symbols/jsonUtils',
    'esri/renderers/jsonUtils',

    'esri/dijit/PopupTemplate',
    'esri/layers/GraphicsLayer',
    'esri/tasks/query',
    'esri/tasks/QueryTask'

], function (
    declare, arrayUtils, lang, Color, connect, on, all,
    SpatialReference, Point, Polygon, Multipoint, Extent, Graphic,
    esriConfig, normalizeUtils,
    SimpleMarkerSymbol, SimpleLineSymbol, SimpleFillSymbol, TextSymbol, Font,
    ClassBreaksRenderer,
    esriRequest, symbolJsonUtils, rendererJsonUtil,
    PopupTemplate, GraphicsLayer, Query, QueryTask
) {

    function concat(a1, a2) {
        return a1.concat(a2);
    }

    function merge(arrs) {
        //var start = new Date().valueOf();
        //console.debug('merge start');
        var len = arrs.length, target = [];
        while (len--) {
            var o = arrs[len];
            if (o.constructor === Array) {
                target = concat(target, o);
            } else {
                target.push(o);
            }
        }
        //var end = new Date().valueOf();
        //console.debug('merge end', (end - start)/1000);
        return target;
    }

    function difference(arr1/*new objectIds*/, cacheCount/*objectId cache length*/, hash/*objecid hash*/) {
        //var start = new Date().valueOf();
        //console.debug('difference start');

        var len = arr1.length, diff = [];
        if (!cacheCount) {
            diff = arr1;
            while (len--) {
                var value = arr1[len];
                if (!hash[value]) {
                    hash[value] = value;
                }
            }

            //var endEarly = new Date().valueOf();
            //console.debug('difference end', (endEarly - start)/1000);

            return diff;
        }
        while (len--) {
            var val = arr1[len];
            if (!hash[val]) {
                hash[val] = val;
                diff.push(val);
            }
        }

        //var end = new Date().valueOf();
        //console.debug('difference end', (end - start)/1000);

        return diff;
    }

    function toPoints(features) {
        var len = features.length;
        var points = [];
        while (len--) {
            var g = features[len];
            points.push(
                new Graphic(
                    g.geometry.getCentroid(),
                    g.symbol, g.attributes,
                    g.infoTemplate
            ));
        }
        return points;
    }

    // Handle non-console supporting browsers
    (function () {
      if (!window.console) {
        window.console = {};
      }
      // union of Chrome, FF, IE, and Safari console methods
      var m = [
        'log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'group',
        'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'profile', 'profileEnd',
        'dirxml', 'assert', 'count', 'markTimeline', 'timeStamp', 'clear'
      ];
      // define undefined methods as noops to prevent errors
      for (var i = 0; i < m.length; i++) {
        if (!window.console[m[i]]) {
          window.console[m[i]] = function() {};
        }
      }
    })();

    return declare([GraphicsLayer], {
        constructor: function(options) {
            // options:
            //     url:    string
            //        URL string. Required. Will generate clusters based on Features returned from map service.
            //     outFields:    Array?
            //        Optional. Defines what fields are returned with Features.
            //     objectIdField:    String?
            //        Optional. Defines the OBJECTID field of service. Default is 'OBJECTID'.
            //     where:    String?
            //        Optional. Where clause for query.
            //     useDefaultSymbol:    Boolean?
            //        Optional. Use the services default symbology for single features.
            //     returnLimit:    Number?
            //        Optional. Return limit of features returned from query. Default is 1000.
            //     distance:    Number?
            //         Optional. The max number of pixels between points to group points in the same cluster. Default value is 50.
            //     labelColor:    String?
            //         Optional. Hex string or array of rgba values used as the color for cluster labels. Default value is #fff (white).
            //     labelOffset:    String?
            //         Optional. Number of pixels to shift a cluster label vertically. Defaults to -5 to align labels with circle symbols. Does not work in IE.
            //     resolution:    Number
            //         Required. Width of a pixel in map coordinates. Example of how to calculate:
            //         map.extent.getWidth() / map.width
            //     showSingles:    Boolean?
            //         Optional. Whether or graphics should be displayed when a cluster graphic is clicked. Default is true.
            //     zoomOnClick:    Boolean?
            //         Optional. Will zoom the map when a cluster graphic is clicked. Default is true.
            //     singleSymbol:    MarkerSymbol?
            //         Marker Symbol (picture or simple). Optional. Symbol to use for graphics that represent single points. Default is a small gray SimpleMarkerSymbol.
            //     singleRenderer:    Renderer?
            //         Optional. Can provide a renderer for single features to override the default renderer.
            //     singleTemplate:    PopupTemplate?
            //         PopupTemplate</a>. Optional. Popup template used to format attributes for graphics that represent single points. Default shows all attributes as 'attribute = value' (not recommended).
            //     disablePopup:    Boolean?
            //         Optional. Disable infoWindow for cluster layer. Default is false.
            //     maxSingles:    Number?
            //         Optional. Threshold for whether or not to show graphics for points in a cluster. Default is 1000.
            //     font:    TextSymbol?
            //         Optional. Font to use for TextSymbol. Default is 10pt, Arial.
            //     spatialReference:    SpatialReference?
            //         Optional. Spatial reference for all graphics in the layer. This has to match the spatial reference of the map. Default is 102100. Omit this if the map uses basemaps in web mercator.
            this._clusterTolerance = options.distance || 50;
            this._clusterData = [];
            this._clusters = [];
            this._clusterLabelColor = options.labelColor || '#000';
            // labelOffset can be zero so handle it differently
            this._clusterLabelOffset = (options.hasOwnProperty('labelOffset')) ? options.labelOffset : -5;
            // graphics that represent a single point
            this._singles = []; // populated when a graphic is clicked
            this._showSingles = options.hasOwnProperty('showSingles') ? options.showSingles : true;
            this._zoomOnClick = options.hasOwnProperty('zoomOnClick') ? options.zoomOnClick : true;
            // symbol for single graphics
            //this._singleSym = options.singleSymbol || new SimpleMarkerSymbol('circle', 6, null, new Color('#888'));
            this._singleSym = options.singleSymbol || new SimpleMarkerSymbol('circle', 16,
                                    new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([85, 125, 140, 1]), 3),
                                    new Color([255, 255, 255, 1]));
            this._singleTemplate = options.singleTemplate || new PopupTemplate({ 'title': '', 'description': '{*}' });
            this._disablePopup = options.disablePopup || false;
            this._maxSingles = options.maxSingles || 10000;

            this._font = options.font || new Font('10pt').setFamily('Arial');

            this._sr = options.spatialReference || new SpatialReference({ 'wkid': 102100 });

            this._zoomEnd = null;

            this.url = options.url || null;
            this._outFields = options.outFields || ['*'];
            this.queryTask = new QueryTask(this.url);
            this._where = options.where || null;
            this._useDefaultSymbol = options.hasOwnProperty('useDefaultSymbol') ? options.useDefaultSymbol : false;
            this._returnLimit = options.returnLimit || 1000;
            this._singleRenderer = options.singleRenderer;

            this._objectIdField = options.objectIdField || 'OBJECTID';

            if (!this.url) {
                throw new Error('url is a required parameter');
            }
            this._clusterCache = {};
            this._objectIdCache = [];
            this._objectIdHash = {};

            // track current cluster and label
            this._currentClusterGraphic = null;
            this._currentClusterLabel = null;

            this._visitedExtent = null;

            this.detailsLoaded = false;

            this._query = new Query();

            this.MODE_SNAPSHOT = options.hasOwnProperty('MODE_SNAPSHOT') ? options.MODE_SNAPSHOT : true;

            this._getServiceDetails();

            esriConfig.defaults.geometryService = 'http://sampleserver6.arcgisonline.com/arcgis/rest/services/Utilities/Geometry/GeometryServer';
        },

        _getServiceDetails: function () {
            esriRequest({
                url: this.url,
                content: {
                    f: 'json'
                },
                handleAs: 'json'
            }).then(lang.hitch(this, function(response) {
                this._defaultRenderer = this._singleRenderer ||
                    rendererJsonUtil.fromJson(response.drawingInfo.renderer);
                if (response.geometryType === 'esriGeometryPolygon') {
                    this._useDefaultSymbol = false;
                    console.info('polygon geometry will be converted to points');
                }
                this.emit('details-loaded', response);
            }));
        },

        _getDefaultSymbol: function (g) {
            var rend = this._defaultRenderer;
            if (!this._useDefaultSymbol || !rend) {
                return this._singleSym;
            } else {
                return rend.getSymbol(g);
            }
        },

        _getRenderedSymbol: function (feature) {
            var attr = feature.attributes;
            if (attr.clusterCount === 1) {
                if (!this._useDefaultSymbol) {
                    return this._singleSym;
                }
                var rend = this._defaultRenderer;
                if (!rend) { // something went wrong getting default renderer
                    return null;
                } else {
                    return rend.getSymbol(feature);
                }
            } else {
                return null;
            }
        },

        // Recluster when extent changes
        _reCluster: function () {
            if (!this.suspended) {
                // update resolution
                this._clusterResolution = this._map.extent.getWidth() / this._map.width;
                // Smarter cluster, only query when we have to
                // Fist time
                if (!this._visitedExtent) {
                    this._getObjectIds(this._map.extent);
                // New extent
                } else if (!this._visitedExtent.contains(this._map.extent)) {
                    this._getObjectIds(this._map.extent);
                // Been there, but is this a pan or zoom level change?
                } else {
                    this._clusterGraphics();
                }
                // update clustered extent
                this._visitedExtent = this._visitedExtent ? this._visitedExtent.union(this._map.extent) : this._map.extent;
            }
        },

        // Function to set the current cluster graphic (lable and cluster) that was clicked.
        _setClickedClusterGraphics: function (g) {
            // Reset
            if (g === null) {
                this._currentClusterGraphic = null;
                this._currentClusterLabel = null;
                return;
            }
            // Cluster was clicked (symbol is null because it's set by renderer)
            if (g.symbol === null) {
                this._currentClusterLabel = this._getCurrentLabelGraphic(g);
                this._currentClusterGraphic = g;
            // Text symbol was clicked
            } else if (g.symbol.declaredClass === 'esri.symbol.TextSymbol') {
                this._currentClusterLabel = g;
                this._currentClusterGraphic = this._getCurrentClusterGraphic(g);
            }
            // Single in a cluster was clicked
            // } else {
            //     this._currentClusterGraphic = null;
            //     this._getCurrentLabelGraphic = null;
            // }
        },

        // Find the actual cluster graphic in the graphics layer
        _getCurrentClusterGraphic: function (c) {
            var gArray = arrayUtils.filter(this.graphics, function (g) {
                return (g.attributes.clusterId === c.attributes.clusterId);
            });
            return gArray[0];
        },

        // Find the actual cluster graphic label in the graphics layer
        _getCurrentLabelGraphic: function (c) {
            var gArray = arrayUtils.filter(this.graphics, function (g) {
                return (g.symbol &&
                    g.symbol.declaredClass === 'esri.symbol.TextSymbol' &&
                    g.attributes.clusterId === c.attributes.clusterId);
            });
            return gArray[0];
        },

        // When the popup appears, toggle the cluster to singles or the singles to a cluster
        _popupVisibilityChange: function () {
            var show = this._map.infoWindow.isShowing;
            // Popup hidden, show cluster
            this._showClickedCluster(!show);
            // Remove singles from layer
            if (!show) {
                //if (this._currentClusterGraphic && this._currentClusterLabel) {
                    this.clearSingles();
                //}
            }
        },

        // Show or hide the currently selected cluster
        _showClickedCluster: function (show) {
            if (this._currentClusterGraphic && this._currentClusterLabel) {
                if (show) {
                    this._currentClusterGraphic.show();
                    this._currentClusterLabel.show();
                } else {
                    this._currentClusterGraphic.hide();
                    this._currentClusterLabel.hide();
                }
            }
        },

        // override esri/layers/GraphicsLayer methods
        _setMap: function (map) {
            this._query.outSpatialReference = map.spatialReference;
            this._query.returnGeometry = true;
            this._query.outFields = this._outFields;
            // listen to extent-change so data is re-clustered when zoom level changes
            this._extentChange = on.pausable(map, 'extent-change', lang.hitch(this, '_reCluster'));
            // listen for popup hide/show - hide clusters when pins are shown
            map.infoWindow.on('hide', lang.hitch(this, '_popupVisibilityChange'));
            map.infoWindow.on('show', lang.hitch(this, '_popupVisibilityChange'));

            var layerAdded = on(map, 'layer-add', lang.hitch(this, function(e) {
                if (e.layer === this) {
                    layerAdded.remove();
                    if (!this.detailsLoaded) {
                        on.once(this, 'details-loaded', lang.hitch(this, function() {
                            if (!this.renderer) {

                                this._singleSym = this._singleSym || new SimpleMarkerSymbol('circle', 16,
                                    new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([85, 125, 140, 1]), 3),
                                    new Color([255, 255, 255, .5]));

                                var renderer = new ClassBreaksRenderer(this._singleSym, 'clusterCount');

                                // Blue clusters
                                small = new SimpleMarkerSymbol('circle', 25,
                                            new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([140,177,210,0.35]), 15),
                                            new Color([140,177,210,0.75]));
                                medium = new SimpleMarkerSymbol('circle', 50,
                                            new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([97,147,179,0.35]), 15),
                                            new Color([97,147,179,0.75]));
                                large = new SimpleMarkerSymbol('circle', 80,
                                            new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([59,110,128,0.35]), 15),
                                            new Color([59,110,128,0.75]));
                                xlarge = new SimpleMarkerSymbol('circle', 110,
                                            new SimpleLineSymbol(SimpleLineSymbol.STYLE_SOLID, new Color([20,72,77,0.35]), 15),
                                            new Color([20,72,77,0.75]));

                                renderer.addBreak(2, 10, small);
                                renderer.addBreak(10, 25, medium);
                                renderer.addBreak(25, 100, large);
                                renderer.addBreak(100, Infinity, xlarge);
                                this.setRenderer(renderer);
                            }
                            this._reCluster();
                        }));
                    }
                }
            }));

            // GraphicsLayer will add its own listener here
            var div = this.inherited(arguments);
            return div;
        },

        _unsetMap: function () {
            this.inherited(arguments);
            this._extentChange.remove();
        },

        _onClusterClick: function (e) {
            var attr = e.graphic.attributes;
            if (attr && attr.clusterCount) {
                // Find points (data) in cluster
                var source = arrayUtils.filter(this._clusterData, function (g) {
                    return attr.clusterId === g.attributes.clusterId;
                }, this);
                this.emit('cluster-click', source);
            }
        },

        // Get the features by IDs
        _getObjectIds: function (extent) {
            // debug
            // this._startGetOids = new Date().valueOf();
            // console.debug('#_getObjectIds start');

            if (this.url) {
                var ext = extent || this._map.extent;
                this._query.objectIds = null;
                if (this._where) {
                    this._query.where = this._where;
                }
                if (!this.MODE_SNAPSHOT) {
                    this._query.geometry = ext;
                }
                if (!this._query.geometry && !this._query.where) {
                    this._query.where = '1=1';
                }
                this.queryTask.executeForIds(this._query).then(
                    lang.hitch(this, '_onIdsReturned'), this._onError
                );
            }
        },

        _onError: function (err) {
            console.warn('ReturnIds Error', err);
        },

        _onIdsReturned: function (results) {
            var uncached = difference(results, this._objectIdCache.length, this._objectIdHash);
            this._objectIdCache = concat(this._objectIdCache, uncached);
            if (uncached && uncached.length) {
                this._query.where = null;
                this._query.geometry = null;
                var queries = [];
                if (uncached.length > this._returnLimit) {
                    while(uncached.length) {
                        // Improve performance by just passing list of IDs
                        this._query.objectIds = uncached.splice(0, this._returnLimit - 1);
                        queries.push(this.queryTask.execute(this._query));
                    }
                    all(queries).then(lang.hitch(this, function(res) {
                        var features = arrayUtils.map(res, function(r) {
                            return r.features;
                        });
                        this._onFeaturesReturned({
                            features: merge(features)
                        });
                    }));
                } else {
                    // Improve performance by just passing list of IDs
                    this._query.objectIds = uncached.splice(0, this._returnLimit - 1);
                    this.queryTask.execute(this._query).then(
                        lang.hitch(this, '_onFeaturesReturned'), this._onError
                    );
                }
            } else if (this._objectIdCache.length) {
                this._onFeaturesReturned({ // kinda hacky here
                    features: []
                });
                //this._clusterGraphics();
            } else {
                this.clear();
            }
        },

        // Return a cache of features in the current extent
        _inExtent: function() {
            // debug
            //var start = new Date().valueOf();
            //console.debug('#inExtent start');
            var ext = this._getNormalizedExtentsPolygon();
            var len = this._objectIdCache.length;
            var valid = [];

            // See if cached feature is in current extent
            while (len--) {
                var oid = this._objectIdCache[len];
                var cached = this._clusterCache[oid];
                if (cached && ext.contains(cached.geometry)) {
                    valid.push(cached);
                }
            }

            // debug
            //var end = new Date().valueOf();
            //console.debug('#inExtent end', (end - start)/1000);
            return valid;
        },

        // Add features to cluster cache and refine cluster data to draw - clears all graphics!
        _onFeaturesReturned: function(results) {
            // debug
            // var end = new Date().valueOf();
            // console.debug('#_onFeaturesReturned end', (end - this._startGetOids)/1000);

            var inExtent = this._inExtent();
            var features;
            if (this.native_geometryType === 'esriGeometryPolygon') {
                features = toPoints(results.features);
            } else {
                features = results.features;
            }
            var len = features.length;
            //this._clusterData.length = 0;
            //this.clear();
            // Update the cluster features for drawing
            if (len) {
                //this._clusterData.lenght = 0;  // Bug
                this._clusterData.length = 0;
                // Delete all graphics in layer (not local features)
                this.clear();
                // Append actual feature to oid cache
                arrayUtils.forEach(features, function(feat) {
                    this._clusterCache[feat.attributes[this._objectIdField]] = feat;
                }, this);
                // Refine features to draw
                this._clusterData = concat(features, inExtent);
            }
            //this._clusterData = concat(features, inExtent);

            // debug
            // var end = new Date().valueOf();
            // console.debug('#_onFeaturesReturned end', (end - start)/1000);

            // Cluster the features
            this._clusterGraphics();
        },

        // public ClusterLayer methods
        updateClusters: function() {
            this.clearCache();
            this._reCluster();
        },

        clearCache: function() {
            // Summary: Clears the cache for clustered items
            arrayUtils.forEach(this._objectIdCache, function(oid) {
                delete this._objectIdCache[oid];
            }, this);
            this._objectIdCache.length = 0;
            this._clusterCache = {};
            this._objectIdHash = {};
        },

        add: function(p) {
            // Summary:    The argument is a data point to be added to an existing cluster. If the data point falls within an existing cluster, it is added to that cluster and the cluster's label is updated. If the new point does not fall within an existing cluster, a new cluster is created.
            //
            // if passed a graphic, use the GraphicsLayer's add method
            if ( p.declaredClass ) {
                this.inherited(arguments);
                return;
            }

            // add the new data to _clusterData so that it's included in clusters when the map level changes
            this._clusterData.push(p);
            var clustered = false;
            // look for an existing cluster for the new point
            for ( var i = 0; i < this._clusters.length; i++ ) {
                var c = this._clusters[i];
                if ( this._clusterTest(p, c) ) {
                    // add the point to an existing cluster
                    this._clusterAddPoint(p, c);
                    // update the cluster's geometry
                    this._updateClusterGeometry(c);
                    // update the label
                    this._updateLabel(c);
                    clustered = true;
                    break;
                }
            }

            if (!clustered) {
                this._clusterCreate(p);
                p.attributes.clusterCount = 1;
                this._showCluster(p);
            }
        },

        clear: function() {
            // Summary:    Remove all clusters and data points.
            this.inherited(arguments);
            this._clusters.length = 0;
        },

        clearSingles: function(singles) {
            // Summary:    Remove graphics that represent individual data points.
            var s = singles || this._singles;
            arrayUtils.forEach(s, function(g) {
                this.remove(g);
            }, this);
            this._singles.length = 0;
        },

        onClick: function(e) {
            // Don't bubble click event to map
            e.stopPropagation();
            // Removed to improve performance - TODO
            // this._onClusterClick(e);

            // Single cluster click - only good until re-cluster!
            if (e.graphic.attributes.clusterCount === 1 ) {
                this._showClickedCluster(true);
                // Unset cluster graphics
                this._setClickedClusterGraphics(null);
                // Remove graphics from layer
                this.clearSingles(this._singles);
                // TODO - overkill, simplify for single clicks
                var singles = this._getClusterSingles(e.graphic.attributes.clusterId);
                arrayUtils.forEach(singles, function(g) {
                    g.setSymbol(this._getDefaultSymbol(g));
                    g.setInfoTemplate(this._singleTemplate);
                }, this);

                // Add graphic to layer
                this._addSingleGraphics(singles);
                if (!this._disablePopup) {
                    this._map.infoWindow.setFeatures(singles);
                    // This hack helps show the popup to show on both sides of the dateline!
                    this._map.infoWindow.show(e.graphic.geometry);
                    this._map.infoWindow.show(e.graphic.geometry);
                }
            }
            // Multi-cluster click, super zoom to cluster
            else if (this._zoomOnClick && e.graphic.attributes.clusterCount > 1 && this._map.getZoom() !== this._map.getMaxZoom())
            {
                // Zoom to level that shows all points in cluster, not necessarily the extent
                var extent = this._getClusterExtent(e.graphic);
                if (extent.getWidth()) {
                    this._map.setExtent(extent.expand(1.5), true);
                } else {
                    this._map.centerAndZoom(e.graphic.geometry, this._map.getMaxZoom());
                }
            // Multi-cluster click, show popup by finding actual singles and assigning to infoWindow
            } else {
                // Remove graphics from layer
                this.clearSingles(this._singles);
                // find single graphics that make up the cluster that was clicked
                // would be nice to use filter but performance tanks with large arrays in IE
                var singles = this._getClusterSingles(e.graphic.attributes.clusterId);
                if ( singles.length > this._maxSingles ) {
                    alert('Sorry, that cluster contains more than ' + this._maxSingles + ' points. Zoom in for more detail.');
                    return;
                } else {
                    // Save and hide the clustered graphics
                    this._showClickedCluster(true);
                    this._setClickedClusterGraphics(e.graphic);
                    this._showClickedCluster(false);
                    // Add graphics to layer
                    this._addSingleGraphics(singles);
                    if (!this._disablePopup) {
                        this._map.infoWindow.setFeatures(this._singles);
                        // This hack helps show the popup to show on both sides of the dateline!
                        this._map.infoWindow.show(e.graphic.geometry);
                        this._map.infoWindow.show(e.graphic.geometry);
                    }
                }
            }
        },

        // Internal graphic methods

        // Build new cluster array from features and draw graphics
        _clusterGraphics: function() {
            // debug
            // var start = new Date().valueOf();
            // console.debug('#_clusterGraphics start');

            // TODO - should test if this is a pan or zoom level change before reclustering

            // Remove all existing graphics from layer
            this.clear();

            // test against a modified/scrubbed map extent polygon geometry
            var testExtent = this._getNormalizedExtentsPolygon();

            // first time through, loop through the points
            for ( var j = 0, jl = this._clusterData.length; j < jl; j++ ) {
                // see if the current feature should be added to a cluster
                var point = this._clusterData[j].geometry || this._clusterData[j];
                // TEST - Only cluster what's in the current extent.  TODO - better way to do this?
                if (!testExtent.contains(point)) {
                    // Reset all other clusters and make sure their id is changed
                    this._clusterData[j].attributes.clusterId = -1;
                    continue;
                }
                var feature = this._clusterData[j];
                var clustered = false;
                // Add point to existing cluster
                for ( var i = 0; i < this._clusters.length; i++ ) {
                    var c = this._clusters[i];
                    if ( this._clusterTest(point, c) ) {
                        this._clusterAddPoint(feature, point, c);
                        clustered = true;
                        // TODO - try to update center of cluster - poor results, should use a grid system
                        // var pts = new Multipoint(this._map.spatialReference);
                        // pts.addPoint(new Point(c.x, c.y));
                        // pts.addPoint(point);
                        // var center = pts.getExtent().getCenter();
                        // c.x = center.x;
                        // c.y = center.y;
                        break;
                    }
                }
                // Or create a new cluster (of one)
                if (!clustered) {
                    this._clusterCreate(feature, point);
                }
            }

            // debug
            // var end = new Date().valueOf();
            // console.debug('#_clusterGraphics end - ClusterData: ' + this._clusterData.length + ' Clusters: ' + this._clusters.length, (end - start)/1000);

            this._showAllClusters();
        },

        // See if point is within the tolerance (pixels) of current cluster
        _clusterTest: function(p, cluster) {
            var distance = (
                Math.sqrt(
                    Math.pow((cluster.x - p.x), 2) + Math.pow((cluster.y - p.y), 2)
            ) / this._clusterResolution
            );
            return (distance <= this._clusterTolerance);
        },

        // points passed to clusterAddPoint should be included
        // in an existing cluster
        // also give the point an attribute called clusterId
        // that corresponds to its cluster
        _clusterAddPoint: function(feature, p, cluster) {
            // Average in the new point to the cluster geometry
            var count, x, y;
            count = cluster.attributes.clusterCount;
            x = (p.x + (cluster.x * count)) / (count + 1);
            y = (p.y + (cluster.y * count)) / (count + 1);
            cluster.x = x;
            cluster.y = y;

            // Build an extent that includes all points in a cluster
            if ( p.x < cluster.attributes.extent[0] ) {
                cluster.attributes.extent[0] = p.x;
            } else if ( p.x > cluster.attributes.extent[2] ) {
                cluster.attributes.extent[2] = p.x;
            }
            if ( p.y < cluster.attributes.extent[1] ) {
                cluster.attributes.extent[1] = p.y;
            } else if ( p.y > cluster.attributes.extent[3] ) {
                cluster.attributes.extent[3] = p.y;
            }

            // Increment the count
            cluster.attributes.clusterCount++;
            // attributes might not exist
            if ( ! p.hasOwnProperty('attributes') ) {
                p.attributes = {};
            }
            // give the graphic a cluster id
            feature.attributes.clusterId = p.attributes.clusterId = cluster.attributes.clusterId;

            on.emit(this, "on-add-point-to-cluster", {
              cluster: cluster,
              point: p
            });
        },

        // Point isn't within the clustering distance specified for the layer so create a new cluster for it
        // TODO: Random and not based on grid dispersion!
        _clusterCreate: function(feature, p) {
            var clusterId = this._clusters.length + 1;
            // console.log('cluster create, id is: ', clusterId);
            // p.attributes might be undefined
            if ( ! p.attributes ) {
                p.attributes = {};
            }
            feature.attributes.clusterId = p.attributes.clusterId = clusterId;
            // create the cluster
            var cluster = {
                'x': p.x,
                'y': p.y,
                'attributes' : {
                    'clusterCount': 1,
                    'clusterId': clusterId,
                    'extent': [ p.x, p.y, p.x, p.y ]
                }
            };
            this._clusters.push(cluster);
            on.emit(this, "on-add-point-to-cluster", {
              cluster: cluster,
              point: p
            });
        },

        // Add all graphics to layer and fire 'clusters-shown' event
        _showAllClusters: function() {
            // debug
            // var start = new Date().valueOf();
            // console.debug('#_showAllClusters start');

            for ( var i = 0, il = this._clusters.length; i < il; i++ ) {
                this._showCluster(this._clusters[i]);
            }
            this.emit('clusters-shown', this._clusters);

            // debug
            // var end = new Date().valueOf();
            // console.debug('#_showAllClusters end', (end - start)/1000);
        },

        // Add graphic and to layer
        _showCluster: function(c) {
            var point = new Point(c.x, c.y, this._sr);

            var g = new Graphic(point, null, c.attributes);
            g.setSymbol(this._getRenderedSymbol(g));
            this.add(g);

            // code below is used to not label clusters with a single point
            if ( c.attributes.clusterCount < 2 ) {
                return;
            }

            // show number of points in the cluster
            var label = new TextSymbol(c.attributes.clusterCount.toString())
                .setColor(new Color(this._clusterLabelColor))
                .setOffset(0, this._clusterLabelOffset)
                .setFont(this._font);
            this.add(
                new Graphic(
                    point,
                    label,
                    c.attributes
                )
            );
        },

        // Internal utility functions
        _findCluster: function(id) {
            var cg = arrayUtils.filter(this.graphics, function(g) {
                return ! g.symbol &&
                    g.attributes.clusterId === c.attributes.clusterId;
            });
        },

        _getClusterExtent: function(cluster) {
            var ext;
            ext = cluster.attributes.extent;
            return new Extent(ext[0],ext[1],ext[2],ext[3], this._map.spatialReference);
        },

        _getClusteredExtent: function () {
            var extent, clusteredExtent;
            for ( var i = 0; i < this._clusters.length; i++ ) {
                extent = this._getClusteredExtent(this._clusters[i]);
                if (!clusteredExtent) {
                    clusteredExtent = extent;
                } else {
                    clusteredExtent = clusteredExtent.union(extent);
                }
            }
            return clusteredExtent;
        },

        // Return all singles for a given cluster id
        _getClusterSingles: function (id) {
            // debug
            // var start = new Date().valueOf();
            // console.debug('#_getClusterSingles start');

            var singles = [];
                for ( var i = 0, il = this._clusterData.length; i < il; i++) {
                    if ( id === this._clusterData[i].attributes.clusterId ) {
                        singles.push(this._clusterData[i]);
                    }
                }

            // debug
            // var end = new Date().valueOf();
            // console.debug('#_getClusterSingles end', (end - start)/1000);

            return singles;
        },

        _addSingleGraphics: function(singles) {
            // add single graphics to the cluster layer
            arrayUtils.forEach(singles, function(g) {
                g.setSymbol(this._getDefaultSymbol(g));
                g.setInfoTemplate(this._singleTemplate);
                this._singles.push(g);
                // Add to layer
                if ( this._showSingles ) {
                    this.add(g);
                }
            }, this);
            //this._map.infoWindow.setFeatures(this._singles);
        },

        _updateClusterGeometry: function(c) {
            // find the cluster graphic
            var cg = arrayUtils.filter(this.graphics, function(g) {
                return ! g.symbol &&
                    g.attributes.clusterId === c.attributes.clusterId;
            });
            if ( cg.length === 1 ) {
                cg[0].geometry.update(c.x, c.y);
            } else {
                console.log('didn not find exactly one cluster geometry to update: ', cg);
            }
        },

        _updateLabel: function(c) {
            // find the existing label
            var label = arrayUtils.filter(this.graphics, function(g) {
                return g.symbol &&
                    g.symbol.declaredClass === 'esri.symbol.TextSymbol' &&
                    g.attributes.clusterId === c.attributes.clusterId;
            });
            if ( label.length === 1 ) {
                // console.log('update label...found: ', label);
                this.remove(label[0]);
                var newLabel = new TextSymbol(c.attributes.clusterCount.toString())
                    .setColor(new Color(this._clusterLabelColor))
                    .setOffset(0, this._clusterLabelOffset)
                    .setFont(this._font);
                this.add(
                    new Graphic(
                        new Point(c.x, c.y, this._sr),
                        newLabel,
                        c.attributes)
                );
            } else {
                console.log('didn not find exactly one label: ', label);
            }
        },

        _getNormalizedExtentsPolygon: function() {
            // normalize map extent and deal with up to 2 Extent geom objects,
            // convert to Polygon geom objects,
            // and combine into a master Polygon geom object to test against
            var normalizedExtents = this._map.extent.normalize();
            var normalizedExtentPolygons = arrayUtils.map(normalizedExtents, function(extent) {
                return Polygon.fromExtent(extent);
            });
            var masterPolygon = new Polygon(this._map.spatialReference);
            arrayUtils.forEach(normalizedExtentPolygons, function(polygon) {
                masterPolygon.addRing(polygon.rings[0]);
            });
            return masterPolygon;
        },

        // debug only...never called by the layer
        _clusterMeta: function() {
            // print total number of features
            console.log('Total:    ', this._clusterData.length);

            // add up counts and print it
            var count = 0;
            arrayUtils.forEach(this._clusters, function(c) {
                count += c.attributes.clusterCount;
            });
            console.log('In clusters:    ', count);
        }

    });
});
