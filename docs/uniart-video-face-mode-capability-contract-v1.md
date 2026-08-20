# UniArt video Face Mode capability contract v1

## Observed

- the canvas uses the public model catalog as its video capability source
- Face Mode is a separate material-authentication capability, not an inferred
  property of image-to-video or image-reference modes

## Frozen rules

- the canvas exposes the Face Mode switch only when
  `video_capability.supports_face_mode` is exactly `true`
- a stored `videoFaceMode=true` value must not be submitted after the user
  selects a model whose current catalog capability does not support Face Mode
- the canvas must not hard-code public model names to infer Face Mode support
- queued task creation continues to use `POST /v1/videos`; progress and results
  continue through `GET /v1/videos/{task_id}` and
  `GET /v1/videos/{task_id}/content`

## Container interaction impact

- no overlay, activation, drag, resize, wheel, menu, or state-machine behavior
  changes
- only the capability-gated visibility of the existing video settings control
  changes
