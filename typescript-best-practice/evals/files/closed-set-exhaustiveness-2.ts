type ShippingSpeed = "standard" | "express" | "overnight";

function getShippingSpeedLabel(speed: ShippingSpeed): undefined | string {
  switch (speed) {
    case "standard":
      return "Standard shipping";
    case "express":
      return "Express shipping";
    case "overnight":
      return "Overnight shipping";
    default:
      return undefined;
  }
}
