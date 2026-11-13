// iPhone5,1, the model reported by the Darwin sysctl and UIDevice bridges.
export const phoneScreen = Object.freeze({width:320, height:568, scale:2});
const orientations = {
  UIInterfaceOrientationPortrait: 1, UIInterfaceOrientationPortraitUpsideDown: 2,
  UIInterfaceOrientationLandscapeRight: 3, UIInterfaceOrientationLandscapeLeft: 4
};
export function initialOrientation(info) {
  return orientations[info.UIInterfaceOrientation] || orientations[info.UISupportedInterfaceOrientations?.[0]] || 1;
}
