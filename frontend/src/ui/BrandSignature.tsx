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
          u<span className="brand-swap">Swap</span>
          <span className="brand-dot">.</span>
        </span>
        <span className="brand-endorsement">
          <span>Powered by</span>
          <span className="brand-upowa-logo" role="img" aria-label="uPowa">
            <img src={upowaLogo} alt="" />
          </span>
        </span>
      </span>
    </>
  );
}
