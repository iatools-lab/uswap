import { translate } from "../app/i18n";
import upowaLogo from "../assets/upowa-logo.png";
import { Swap } from "./icons";

export function BrandSignature() {
  return (
    <>
      <span className="brand-symbol" aria-hidden="true">
        <Swap size={22} stroke={2.2} />
      </span>
      <span className="brand-lockup">
        <span className="brand-name">
          {translate("u")}<span className="brand-swap">{translate("Swap")}</span>
          <span className="brand-dot">{translate(".")}</span>
        </span>
        <span className="brand-endorsement">
          <span>{translate("Powered by")}</span>
          <span className="brand-upowa-logo" role="img" aria-label={translate("uPowa")}>
            <img src={upowaLogo} alt={translate("")} />
          </span>
        </span>
      </span>
    </>
  );
}
