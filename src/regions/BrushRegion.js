import React, { useCallback, useContext, useMemo, useRef, useState } from "react";
import { Group, Image, Layer, Shape } from "react-konva";
import { observer } from "mobx-react";
import { getParent, getRoot, hasParent, types } from "mobx-state-tree";

import Canvas from "../utils/canvas";
import NormalizationMixin from "../mixins/Normalization";
import RegionsMixin from "../mixins/Regions";
import Registry from "../core/Registry";
import WithStatesMixin from "../mixins/WithStates";
import { ImageModel } from "../tags/object/Image";
import { LabelOnMask } from "../components/ImageView/LabelOnRegion";
import { guidGenerator } from "../core/Helpers";
import { AreaMixin } from "../mixins/AreaMixin";
import { colorToRGBAArray, rgbArrayToHex } from "../utils/colors";
import { defaultStyle } from "../core/Constants";
import { AliveRegion } from "./AliveRegion";
import { KonvaRegionMixin } from "../mixins/KonvaRegion";
import { RegionWrapper } from "./RegionWrapper";
import { Geometry } from "../components/RelationsOverlay/Geometry";
import { ImageViewContext } from "../components/ImageView/ImageViewContext";
import IsReadyMixin from "../mixins/IsReadyMixin";

const highlightOptions = {
  shadowColor: "red",
  shadowBlur: 1,
  shadowOffsetY: 2,
  shadowOffsetX: 2,
  shadowOpacity: 1,
};

const Points = types
  .model("Points", {
    id: types.optional(types.identifier, guidGenerator),
    type: types.optional(types.enumeration(["add", "eraser"]), "add"),
    points: types.array(types.number),
    relativePoints: types.array(types.number),

    /**
     * Stroke width
     */
    strokeWidth: types.optional(types.number, 25),
    relativeStrokeWidth: types.optional(types.number, 25),
    /**
     * Eraser size
     */
    eraserSize: types.optional(types.number, 25),
  })
  .views(self => ({
    get store() {
      return getRoot(self);
    },
    get parent() {
      if (!hasParent(self, 2)) return null;
      return getParent(self, 2);
    },
    get stage() {
      return self.parent?.parent;
    },
    get compositeOperation() {
      return self.type === "add" ? "source-over" : "destination-out";
    },
  }))
  .actions(self => {
    return {
      updateImageSize(wp, hp,sw,sh) {
        self.points = self.relativePoints.map((v,idx)=> {
          const isX = !(idx%2);
          const stageSize = isX ? sw : sh;

          return (v * stageSize) / 100;
        });
        self.strokeWidth = self.relativeStrokeWidth * sw / 100;
      },

      setType(type) {
        self.type = type;
      },

      addPoint(x, y) {
        // scale it back because it would be scaled on draw
        x = x / self.parent.scaleX;
        y = y / self.parent.scaleY;
        self.points.push(x);
        self.points.push(y);
      },

      setPoints(points) {
        self.points = points.map((c, i) => c / (i % 2 === 0 ? self.parent.scaleX : self.parent.scaleY));
        self.relativePoints = points.map((c, i)=> (c / (i % 2 === 0 ? self.stage.stageWidth : self.stage.stageHeight)* 100));
        self.relativeStrokeWidth = self.strokeWidth / self.stage.stageWidth * 100;
      },

      // rescale points to the new width and height from the original
      rescale(origW, origH, destW) {
        const s = destW / origW;

        return self.points.map(p => p * s);
      },

      scaledStrokeWidth(origW, origH, destW) {
        const s = destW / origW;

        return s * self.strokeWidth;
      },
    };
  });

/**
 * Rectangle object for Bounding Box
 *
 */
const Model = types
  .model({
    id: types.optional(types.identifier, guidGenerator),
    pid: types.optional(types.string, guidGenerator),

    type: "brushregion",
    object: types.late(() => types.reference(ImageModel)),

    coordstype: types.optional(types.enumeration(["px", "perc"]), "perc"),

    rle: types.frozen(),

    touches: types.array(Points),
    currentTouch: types.maybeNull(types.reference(Points)),
  })
  .volatile(() => ({
    /**
     * Higher values will result in a more curvy line. A value of 0 will result in no interpolation.
     */
    tension: 0.0,
    /**
     * Stroke color
     */
    // strokeColor: types.optional(types.string, "red"),

    /**
     * Determines node opacity. Can be any number between 0 and 1
     */
    opacity: 0.6,
    scaleX: 1,
    scaleY: 1,

    // points: types.array(types.array(types.number)),
    // eraserpoints: types.array(types.array(types.number)),

    mode: "brush",

    needsUpdate: 1,
    hideable: true,
    layerRef: undefined,
    imageData: null,
  }))
  .views(self => {
    return {
      get parent() {
        return self.object;
      },
      get colorParts() {
        const style = self.style || self.tag || defaultStyle;

        return colorToRGBAArray(style.strokecolor);
      },
      get strokeColor() {
        return rgbArrayToHex(self.colorParts);
      },
      get touchesLength() {
        return self.touches.length;
      },
      get bboxCoords() {
        if (!self.imageData) {
          const points = { x: [], y:[] };

          for(let i = 0; i in (self.touches?.[0]?.points ?? []); i += 2) {
            const curX = (self.touches?.[0]?.points ?? [])[i];
            const curY = (self.touches?.[0]?.points ?? [])[i+1];

            points.x.push(curX);
            points.y.push(curY);
          }
          return {
            left: Math.min(...points.x),
            top: Math.min(...points.y),
            right: Math.max(...points.x),
            bottom: Math.max(...points.y),
          };
        }
        const imageBBox = Geometry.getImageDataBBox(self.imageData.data, self.imageData.width, self.imageData.height);

        if (!imageBBox) return null;
        const { stageScale: scale = 1, zoomingPositionX: offsetX = 0, zoomingPositionY: offsetY = 0 } = self.parent || {};

        imageBBox.x = imageBBox.x/scale - offsetX/scale;
        imageBBox.y = imageBBox.y/scale - offsetY/scale;
        imageBBox.width = imageBBox.width/scale;
        imageBBox.height = imageBBox.height/scale;
        return  {
          left: imageBBox.x,
          top: imageBBox.y,
          right: imageBBox.x + imageBBox.width,
          bottom: imageBBox.y + imageBBox.height,
        };
      },
    };
  })
  .actions(self => {
    let pathPoints,
      cachedPoints,
      lastPointX = -1,
      lastPointY = -1;

    return {
      afterCreate() {
        // if ()
        // const newdata = ctx.createImageData(750, 937);
        // newdata.data.set(decode(item._rle));
        // const dec = decode(self._rle);
        // self._rle_image =
        // item._cached_mask = decode(item._rle);
        // const newdata = ctx.createImageData(750, 937);
        //     newdata.data.set(item._cached_mask);
        //     var img = imagedata_to_image(newdata);
      },

      setLayerRef(ref) {
        if (ref) {
          ref.canvas._canvas.style.opacity = self.opacity;
          self.layerRef = ref;
        }
      },

      cacheImageData() {
        if (!self.layerRef) {
          self.imageData = null;
        } else {
          const canvas = self.layerRef.toCanvas();
          const ctx = canvas.getContext("2d");

          self.imageData = ctx.getImageData(0, 0, self.layerRef.canvas.width, self.layerRef.canvas.height);
        }
      },

      prepareCoords([x, y]) {
        return self.parent.zoomOriginalCoords([x, y]);
      },

      preDraw(x, y) {
        if (!self.layerRef) return;
        const layer = self.layerRef;
        const ctx = layer.canvas.context;

        ctx.save();
        ctx.beginPath();
        if (cachedPoints.length / 2 > 3) {
          ctx.moveTo(...self.prepareCoords([lastPointX, lastPointY]));
        } else if (cachedPoints.length === 0) {
          ctx.moveTo(...self.prepareCoords([x, y]));
        } else {
          ctx.moveTo(...self.prepareCoords([cachedPoints[0], cachedPoints[1]]));
          for (let i = 0; i < cachedPoints.length / 2; i++) {
            ctx.lineTo(...self.prepareCoords([cachedPoints[2 * i], cachedPoints[2 * i + 1]]));
          }
        }
        ctx.lineTo(...self.prepareCoords([x, y]));
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = pathPoints.strokeWidth * self.scaleX * self.parent.stageScale;
        ctx.strokeStyle = self.strokeColor;
        ctx.globalCompositeOperation = pathPoints.compositeOperation;
        ctx.stroke();
        ctx.restore();
        lastPointX = x;
        lastPointY = y;
      },

      beginPath({ type, strokeWidth, opacity = self.opacity }) {
        // don't start to save another regions in the middle of drawing process
        self.object.annotation.pauseAutosave();

        pathPoints = Points.create({ id: guidGenerator(), type, strokeWidth, opacity });
        cachedPoints = [];
        return pathPoints;
      },

      addPoint(x, y) {
        self.preDraw(x, y);
        cachedPoints.push(x);
        cachedPoints.push(y);
      },

      endPath() {
        const { annotation } = self.object;

        // will resume in the next tick...
        annotation.startAutosave();

        if (cachedPoints.length === 2) {
          cachedPoints.push(cachedPoints[0]);
          cachedPoints.push(cachedPoints[1]);
        }
        self.touches.push(pathPoints);
        self.currentTouch = pathPoints;
        pathPoints.setPoints(cachedPoints);
        lastPointX = lastPointY = -1;
        pathPoints = null;
        cachedPoints = [];

        self.notifyDrawingFinished();

        // ...so we run this toggled function also delayed
        annotation.autosave && setTimeout(() => annotation.autosave());
      },

      convertPointsToMask() {},

      setScale(x, y) {
        self.scaleX = x;
        self.scaleY = y;
      },

      updateImageSize(wp, hp, sw, sh) {
        if (self.parent.stageWidth > 1 && self.parent.stageHeight > 1) {
          self.touches.forEach(stroke => stroke.updateImageSize(wp, hp, sw, sh));

          self.needsUpdate = self.needsUpdate + 1;
        }
      },

      addState(state) {
        self.states.push(state);
      },

      convertToImage() {
        if (self.touches.length) {
          const object = self.object;
          const rle = Canvas.Region2RLE(self, object, {
            color: self.strokeColor,
          });

          self.touches = [];
          self.rle = Array.from(rle);
        }
      },

      /**
       * @example
       * {
       *   "original_width": 1920,
       *   "original_height": 1280,
       *   "image_rotation": 0,
       *   "value": {
       *     "format": "rle",
       *     "rle": [0, 1, 1, 2, 3],
       *     "brushlabels": ["Car"]
       *   }
       * }
       * @typedef {Object} BrushRegionResult
       * @property {number} original_width  - Width of the original image (px)
       * @property {number} original_height - Height of the original image (px)
       * @property {number} image_rotation  - Rotation degree of the image (deg)
       * @property {Object} value
       * @property {"rle"} value.format     - Format of the masks, only RLE is supported for now
       * @property {number[]} value.rle     - RLE-encoded image
       */

      /**
       * @param {object} options
       * @param {boolean} [options.fast] Saving only touches, without RLE
       * @return {BrushRegionResult}
       */
      serialize(options) {
        const object = self.object;
        const value = { format: "rle" };

        if (options?.fast) {
          value.rle = self.rle;

          if (self.touches.length) value.touches = self.touches;
        } else {
          const rle = Canvas.Region2RLE(self, object);

          if (!rle || !rle.length) return null;

          // UInt8Array serializes as object, not an array :(
          value.rle = Array.from(rle);
        }

        const res = {
          original_width: object.naturalWidth,
          original_height: object.naturalHeight,
          image_rotation: object.rotation,
          value,
        };

        return res;
      },
    };
  });

const BrushRegionModel = types.compose(
  "BrushRegionModel",
  WithStatesMixin,
  RegionsMixin,
  NormalizationMixin,
  AreaMixin,
  KonvaRegionMixin,
  IsReadyMixin,
  Model,
);

const HtxBrushLayer = observer(({ item, pointsList }) => {
  const drawLine = useCallback((ctx, { points, strokeWidth, strokeColor, compositeOperation }) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 0; i < points.length / 2; i++) {
      ctx.lineTo(points[2 * i], points[2 * i + 1]);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;
    ctx.globalCompositeOperation = compositeOperation;
    ctx.stroke();
    ctx.restore();
  });

  const sceneFunc = useCallback(
    (context) => {
      pointsList.forEach(points => {
        drawLine(context, {
          points: points.points,
          strokeWidth: points.strokeWidth,
          strokeColor: item.strokeColor,
          compositeOperation: points.compositeOperation,
        });
      });
    },
    [pointsList, pointsList.length, item.strokeColor],
  );

  const hitFunc = useCallback(
    (context, shape) => {
      pointsList.forEach(points => {
        drawLine(context, {
          points: points.points,
          strokeWidth: points.strokeWidth,
          strokeColor: points.type === "eraser" ? "#ffffff" : shape.colorKey,
          compositeOperation: "source-over",
        });
      });
    },
    [pointsList, pointsList.length],
  );

  return <Shape ref={node => item.setShapeRef(node)} sceneFunc={sceneFunc} hitFunc={hitFunc} />;
});

const HtxBrushView = ({ item }) => {
  const [image, setImage] = useState();
  const { suggestion } = useContext(ImageViewContext) ?? {};

  // Prepare brush stroke from RLE with current stroke color
  useMemo(() => {
    if (!item.rle || !item.parent || item.parent.naturalWidth <=1 || item.parent.naturalHeight <= 1) return;
    const img = Canvas.RLE2Region(item.rle, item.parent, { color: item.strokeColor });

    img.onload = () => {
      setImage(img);
      item.setReady(true);
    };
  }, [
    item.rle,
    item.parent,
    item.parent?.naturalWidth,
    item.parent?.naturalHeight,
    item.strokeColor,
  ]);

  // Drawing hit area by shape color to detect interactions inside the Konva
  const imageHitFunc = useMemo(()=>{
    let imageData;

    return (context, shape) => {
      if (image) {
        if (!imageData) {
          context.drawImage(image, 0, 0, item.parent.stageWidth, item.parent.stageHeight);
          imageData = context.getImageData(0, 0, item.parent.stageWidth, item.parent.stageHeight);
          const colorParts = colorToRGBAArray(shape.colorKey);

          for (let i = imageData.data.length / 4 - 1; i >= 0; i--) {
            if (imageData.data[i * 4 + 3] > 0) {
              for (let k = 0; k < 3; k++) {
                imageData.data[i * 4 + k] = colorParts[k];
              }
            }
          }
        }
        context.putImageData(imageData, 0, 0);
      }
    };
  }, [image, item.parent?.stageWidth, item.parent?.stageHeight]);

  const { store } = item;

  const highlightedImageRef = useRef(new window.Image());
  const layerRef = useRef();
  const highlightedRef = useRef({});

  highlightedRef.current.highlighted = item.highlighted;
  highlightedRef.current.highlight = highlightedRef.current.highlighted ? highlightOptions : { shadowOpacity: 0 };

  // Caching drawn brush strokes (from the rle field and from the touches field) for bounding box calculations and highlight applying
  const drawCallback = useMemo(()=>{
    let done = false;

    return () => {
      const { highlighted } = highlightedRef.current;
      const layer = layerRef.current;
      const isDrawing = item.parent?.drawingRegion === item;

      if (isDrawing || !layer || done) return;
      let highlightEl;

      if (highlighted) {
        highlightEl = layer.findOne(".highlight");
        highlightEl.hide();
      }
      layer.draw();

      const dataUrl = layer.canvas.toDataURL();

      item.cacheImageData();

      if (highlighted) {
        highlightEl.show();
        layer.draw();
      }

      highlightedImageRef.current.src = dataUrl;
      done = true;
    };
  }, [
    item.touches.length,
    item.strokeColor,
    item.parent.stageScale,
    store.annotationStore.selected?.id,
    item.parent?.zoomingPositionX,
    item.parent?.zoomingPositionY,
    item.parent?.stageWidth,
    item.parent?.stageHeight,
    item.rle,
    image,
  ]);

  if (!item.parent) return null;

  const stage = item.parent?.stageRef;

  return (
    <RegionWrapper item={item}>
      <Layer
        id={item.cleanId}
        ref={ref => {
          item.setLayerRef(ref);
          layerRef.current = ref;
        }}
        onDraw={() => {
          setTimeout(drawCallback);
        }}
        clearBeforeDraw={!item.isDrawing}
        visible={!item.hidden}
      >
        <Group
          attrMy={item.needsUpdate}
          name="segmentation"
          // onClick={e => {
          //     e.cancelBubble = false;
          // }}
          onMouseDown={e => {
            if (store.annotationStore.selected.relationMode) {
              e.cancelBubble = true;
            }
          }}
          onMouseOver={() => {
            if (store.annotationStore.selected.relationMode) {
              item.setHighlight(true);
              stage.container().style.cursor = "crosshair";
            } else {
              // no tool selected
              if (!item.parent.getToolsManager().findSelectedTool()) stage.container().style.cursor = "pointer";
            }
          }}
          onMouseOut={() => {
            if (store.annotationStore.selected.relationMode) {
              item.setHighlight(false);
            }

            if (!item.parent?.getToolsManager().findSelectedTool()) {
              stage.container().style.cursor = "default";
            }
          }}
          onClick={e => {
            if (item.parent.getSkipInteractions()) return;
            if (store.annotationStore.selected.relationMode) {
              item.onClickRegion(e);
              return;
            }

            if (item.parent.getToolsManager().findSelectedTool()) return;

            if (store.annotationStore.selected.relationMode) {
              stage.container().style.cursor = "default";
            }

            item.setHighlight(false);
            item.onClickRegion(e);
          }}
          listening={!suggestion && item.editable}
        >
          {/* RLE */}
          <Image
            image={image}
            hitFunc={imageHitFunc}
            width={item.parent.stageWidth}
            height={item.parent.stageHeight}
          />

          {/* Touches */}
          <Group>
            <HtxBrushLayer store={store} item={item} pointsList={item.touches} />
          </Group>

          {/* Highlight */}
          <Image
            name="highlight"
            image={highlightedImageRef.current}
            sceneFunc={highlightedRef.current.highlighted ? null : () => {}}
            hitFunc={() => {}}
            {...highlightedRef.current.highlight}
            scaleX={1/item.parent.stageScale}
            scaleY={1/item.parent.stageScale}
            x={-item.parent.zoomingPositionX/item.parent.stageScale}
            y={-item.parent.zoomingPositionY/item.parent.stageScale}
            width={item.parent.stageWidth}
            height={item.parent.stageHeight}
            listening={false}
          />
        </Group>
      </Layer>
      <Layer
        id={item.cleanId+"_labels"}
        ref={ref => {
          if (ref) {
            ref.canvas._canvas.style.opacity = item.opacity;
          }
        }}
      >
        <Group>
          <LabelOnMask item={item} color={item.strokeColor}/>
        </Group>
      </Layer>
    </RegionWrapper>

  );
};

const HtxBrush = AliveRegion(HtxBrushView, { renderHidden: true });

Registry.addTag("brushregion", BrushRegionModel, HtxBrush);
Registry.addRegionType(BrushRegionModel, "image", value => value.rle || value.touches);

export { BrushRegionModel, HtxBrush };
