import { describe, expect, it } from "vitest";

import {
  CookieJar,
  aspHiddenFields,
  contactLine,
  findLogoutLink,
  loginFieldNames,
  parseJobDetails,
} from "@/lib/planroom.server";

// The state planroom's sign-in form, saved Sep 29, 2026 (tokens shortened).
const LOGIN = `<form method="post" action="./Login.aspx?ReturnUrl=%2fView%2fViewJob.aspx%3fjob_id%3d29681" onsubmit="javascript:return WebForm_OnSubmit();" id="ctl01">
<div class="aspNetHidden">
<input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value="" />
<input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value="" />
<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="i6n/W9G5vF6+OV8RyzNIFJbVm3ARHs3ARaj1xuXDrDUb9cAbGgWd+BU2rfnF…" />
</div>

<script type="text/javascript">
//<![CDATA[
var theForm = document.forms['ctl01'];
if (!theForm) {
    theForm = document.ctl01;
}
function __doPostBack(eventTarget, eventArgument) {
    if (!theForm.onsubmit || (theForm.onsubmit() != false)) {
        theForm.__EVENTTARGET.value = eventTarget;
        theForm.__EVENTARGUMENT.value = eventArgument;
        theForm.submit();
    }
}
//]]>
</script>



<script src="/ScriptResource.axd?d=YJCxcK2hI-bLBJXUFvzl16v_Sx-D75-WEPD5EoaB6irPsU69EvYdhlcQ5gIu45tWP4u50Z9Oaz6ScKZtsrkDYzIJZxZFkGrg3mK3rPSUBh3k4txNa8Ne7cYp0no2WFBEs28ZfA2&amp;t=ffffffff93d1c106" type="text/javascript"></script>
<script src="/ScriptResource.axd?d=uHIkleVeDJf4xS50Krz-yBKs47erk3Vt1hEllttJptYlHnHLod7Ha6YzkzNPRDCJV8KkXccvnLSx_m69jR7nXCbO41NuhfY22rd7y3D_cU7CHd5pPiUL9RyB45ueeI6QMQiPtE0z18oC9fXBxiYu5b_HiJk1&amp;t=5c0e0825" type="text/javascript"></script>
<script src="/ScriptResource.axd?d=Jw6tUGWnA15YEa3ai3FadJ0u93Gzo93Qtv-0D4MOPI_37HF47zDeeRlYbVgYzQ7hQprkcBnCg5T-bXP_8uwHCi5UrpxfqMQ5NqcviNeR9s_HLN2oDJUJ4kcyyh0KC89LryC-zaFnmVlNzmn4S_8KWeLMeUs1&amp;t=5c0e0825" type="text/javascript"></script>
<script src="../Common/JS/jQuery/jquery.min.js" type="text/javascript"></script>
<script src="/ScriptResource.axd?d=hGRhFfagYKxNYsw-jX78ZFYis65VvQEtF0jEnboRDgaCo1LNL3DJ33pjKIvCWICltvgQRssCEcdXdY3H2baFbWqN7swADqXwZ9gcnX4RqttDepDe0msgtJbPUyeq-9-LEbAZTA2&amp;t=ffffffff93d1c106" type="text/javascript"></script>
<script src="/ScriptResource.axd?d=1HpV3OVB0CaEXoaafcqmhpb4WiCBNhYqbqbfrNJ2mQMC1cSgCYC9kofJHePC8J5EMxOVlsY5xFCUYH7_5ePe5oCEIxmR8cUsSqv4ltjPgVtqnp6-Ypp26KssI0FDxejDSYAiqw2&amp;t=ffffffff93d1c106" type="text/javascript"></script>
<script type="text/javascript">
//<![CDATA[
function WebForm_OnSubmit() {
if (typeof(ValidatorOnSubmit) == "function" && ValidatorOnSubmit() == false) return false;
return true;
}
//]]>
</script>

<div class="aspNetHidden">

	<input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="9E2F880E" />
	<input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="XlmJghhcPTARNXKqtJnTjB6lyJqfRff9B7W6785pi0oJa/E12utWCgjU8e16…" />
</div>
            
            
            <script type="text/javascript">
//<![CDATA[
Sys.WebForms.PageRequestManager._initialize('ctl00$ctl07', 'ctl01', ['tctl00$cphMain$ctl00','cphMain_ctl00'], [], [], 90, 'ctl00');
//]]>
</script>

            
<div class="topMenu">
<div class="topLeftMenu">
<div id="ctl08_MenuControl">
	<ul class="level1">
		<li><a class="level1" href="ViewJobList.aspx?group_id=public_all">Public Projects</a></li><li><a class="level1" href="ViewJobList.aspx?group_id=private_all">Private Projects</a></li><li><a class="level1" href="ItemList.aspx?ItemTypeID=2">Addendum Watch</a></li><li><a class="level1" href="ItemList.aspx?ItemTypeID=7">Bid Tab Watch</a></li><li><a class="level1 selected" href="Login.aspx">Sign In/Register</a></li>
	</ul>
</div>
</div>
<table class="topRightMenu">
<tr>
<td>
<div id="ctl08_PublicJobsQueryPanel" onkeypress="javascript:return WebForm_FireDefaultButton(event, &#39;ctl08_PublicJobsQuerySubmit&#39;)">
	
<div class="searchGrid"><input name="ctl00$ctl08$PublicJobsQuery" type="text" id="ctl08_PublicJobsQuery" class="searchQuery" placeholder="Search Projects" /><a id="ctl08_PublicJobsQuerySubmit" class="searchButton" href="javascript:__doPostBack(&#39;ctl00$ctl08$PublicJobsQuerySubmit&#39;,&#39;&#39;)"></a></div>

</div>
</td>
<td id="ctl08_RightTD"><a href="Calendar.aspx" class="calendar"></a><a href="https://www.lynnimaging.com/contact-us/" target="_blank" class="help"></a></td>

</tr>
</table>
<div style="clear:both"></div>
</div>
            <div id="MainPlaceholderOuter" class="mainContent">
                
                
                
    <div class="signInPageWrapper">
        <div id="cphMain_ctl00">
	
                <h1 class="divBox1">Sign In</h1>
                <div class="divBox2">
                    <div class="formInner">
                        
                        <table class="login" cellspacing="0" cellpadding="1" id="cphMain_lgLogin" style="border-collapse:collapse;">
		<tr>
			<td><table cellpadding="0">
				<tr>
					<td><label for="cphMain_lgLogin_UserName">Email Address:</label></td>
				</tr><tr>
					<td><input name="ctl00$cphMain$lgLogin$UserName" type="text" id="cphMain_lgLogin_UserName" /><span data-val-controltovalidate="cphMain_lgLogin_UserName" data-val-errormessage="User Name is required." data-val-validationGroup="ctl00$cphMain$lgLogin" id="cphMain_lgLogin_UserNameRequired" title="User Name is required." data-val="true" data-val-evaluationfunction="RequiredFieldValidatorEvaluateIsValid" data-val-initialvalue="" style="visibility:hidden;">*</span></td>
				</tr><tr>
					<td><label for="cphMain_lgLogin_Password">Password:</label></td>
				</tr><tr>
					<td><input name="ctl00$cphMain$lgLogin$Password" type="password" id="cphMain_lgLogin_Password" /><span data-val-controltovalidate="cphMain_lgLogin_Password" data-val-errormessage="Password is required." data-val-validationGroup="ctl00$cphMain$lgLogin" id="cphMain_lgLogin_PasswordRequired" title="Password is required." data-val="true" data-val-evaluationfunction="RequiredFieldValidatorEvaluateIsValid" data-val-initialvalue="" style="visibility:hidden;">*</span></td>
				</tr><tr>
					<td><input id="cphMain_lgLogin_RememberMe" type="checkbox" name="ctl00$cphMain$lgLogin$RememberMe" /><label for="cphMain_lgLogin_RememberMe">Remember Me</label></td>
				</tr><tr>
					<td align="right"><input type="submit" name="ctl00$cphMain$lgLogin$LoginButton" value="Log In" onclick="javascript:WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(&quot;ctl00$cphMain$lgLogin$LoginButton&quot;, &quot;&quot;, true, &quot;ctl00$cphMain$lgLogin&quot;, &quot;&quot;, false, false))" id="cphMain_lgLogin_LoginButton" class="marginTop" /></td>
				</tr>
			</table></td>
		</tr>
	</table>
                        <span id="cphMain_lblError" style="color:Red;"></span>
                    </div>
                </div>
                <a href="javascript:void(0)" class="h2 marginTop" style="display:block; text-align:center" onclick="this.style.display='none';document.getElementById('cphMain_ResetOrRecover').style.display='block'">Reset Password</a>
                <div id="cphMain_ResetOrRecover" class="marginTop" style="display:none">
                    <h2 class="divBox1">Reset Password</h2>
                    <div class="divBox2">
                        <div class="formInner">
                            <label for="cphMain_txtUsernameFP" id="cphMain_lblUsernameFP">Email Address:</label>
                            <input name="ctl00$cphMain$txtUsernameFP" type="text" id="cphMain_txtUsernameFP" />
                            <span data-val-controltovalidate="cphMain_txtUsernameFP" data-val-errormessage="*" data-val-display="Dynamic" data-val-validationGroup="UFP" id="cphMain_rfvUsernameFP" data-val="true" data-val-evaluationfunction="RequiredFieldValidatorEvaluateIsValid" data-val-initialvalue="" style="display:none;">*</span>
                            <p>Password reset instructions will be sent to your email address.</p>
                            <input type="submit" name="ctl00$cphMain$btnRecoverPassword" value="Reset" onclick="javascript:WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(&quot;ctl00$cphMain$btnRecoverPassword&quot;, &quot;&quot;, true, &quot;UFP&quot;, &quot;&quot;, false, false))" id="cphMain_btnRecoverPassword" class="marginTop" />
                            
                        </div>
                    </div>
                    
                </div>
                <h2 class="divBox1">New User?</h2>
                <div class="divBox2" style="text-align:center">
                    <input type="submit" name="ctl00$cphMain$btnRegister" value="Register Here" id="cphMain_btnRegister" style="font-size:16px;" />
                </div>
            
</div>
    </div>

            </div>
        
<script type='text/javascript'>new Sys.WebForms.Menu({ element: 'ctl08_MenuControl', disappearAfter: 500, orientation: 'horizontal', tabIndex: 0, disabled: false });</script></form>`;

describe("planroom sign-in form", () => {
  it("finds the WebForms tokens and the login field names by suffix", () => {
    const hidden = aspHiddenFields(LOGIN);
    expect(Object.keys(hidden)).toEqual(
      expect.arrayContaining(["__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"]),
    );
    expect(hidden["__VIEWSTATEGENERATOR"]).toBe("9E2F880E");
    expect(loginFieldNames(LOGIN)).toEqual({
      user: "ctl00$cphMain$lgLogin$UserName",
      pass: "ctl00$cphMain$lgLogin$Password",
      button: "ctl00$cphMain$lgLogin$LoginButton",
      action: "./Login.aspx?ReturnUrl=%2fView%2fViewJob.aspx%3fjob_id%3d29681",
    });
  });
  it("keeps cookies across hops, latest value wins", () => {
    const jar = new CookieJar();
    jar.absorb(
      new Response("", { headers: { "set-cookie": "ASP.NET_SessionId=abc; path=/; HttpOnly" } }),
    );
    jar.absorb(new Response("", { headers: { "set-cookie": ".ASPXAUTH=tok; path=/; secure" } }));
    jar.absorb(new Response("", { headers: { "set-cookie": "ASP.NET_SessionId=def; path=/" } }));
    expect(jar.header()).toBe("ASP.NET_SessionId=def; .ASPXAUTH=tok");
    expect(jar.has(".ASPXAUTH")).toBe(true);
  });
});

describe("planroom job page", () => {
  const PAGE = `<html><body>
    <h2>RFB-86-27 FSS - Jackson SOB Roof Replacement</h2>
    <table>
      <tr><td>Owner:</td><td>Commonwealth of Kentucky, Finance &amp; Administration Cabinet</td></tr>
      <tr><td>Contact:</td><td>Jane Doe</td></tr>
      <tr><td>Phone:</td><td>(502) 555-0100</td></tr>
      <tr><td>Architect:</td><td>Sherman Carter Barnhart</td></tr>
      <tr><td>Bid Date:</td><td>10/20/2026 01:30 PM ET</td></tr>
    </table>
    <p>Email: jane.doe@ky.gov</p>
    <p>Questions to support@lynnimaging.com</p>
    <h3>Plan Holders</h3>
    <table>
      <tr><th>Company</th><th>City</th></tr>
      <tr><td>Alpha Roofing LLC</td><td>Lexington</td></tr>
      <tr><td>Beta Builders</td><td>Jackson</td></tr>
    </table>
  </body></html>`;
  it("reads label/value pairs, e-mails (not Lynn's), phones and plan holders", () => {
    const d = parseJobDetails(PAGE);
    expect(d.fields["owner"]).toBe("Commonwealth of Kentucky, Finance & Administration Cabinet");
    expect(d.fields["contact"]).toBe("Jane Doe");
    expect(d.fields["architect"]).toBe("Sherman Carter Barnhart");
    expect(d.fields["bid date"]).toBe("10/20/2026 01:30 PM ET");
    expect(d.emails).toEqual(["jane.doe@ky.gov"]);
    expect(d.phones).toEqual(["(502) 555-0100"]);
    expect(d.planHolders).toEqual(["Alpha Roofing LLC", "Beta Builders"]);
  });
  it("makes the card's contact line", () => {
    expect(contactLine(parseJobDetails(PAGE))).toBe(
      "Owner Commonwealth of Kentucky, Finance & Administration Cabinet — Jane Doe — A/E Sherman Carter Barnhart — jane.doe@ky.gov — (502) 555-0100 — Plan holders: Alpha Roofing LLC, Beta Builders",
    );
    expect(contactLine(parseJobDetails("<html><body>nothing</body></html>"))).toBeNull();
  });
});

describe("planroom sign-out link", () => {
  it("finds the site's own log-out link and makes it absolute", () => {
    const html = `<a href="ViewJobList.aspx">Public Projects</a> <a href="Logout.aspx?x=1">Sign Out</a>`;
    expect(
      findLogoutLink(html, "https://www.stateofkyplanroom.com/View/ViewJob.aspx?job_id=1"),
    ).toBe("https://www.stateofkyplanroom.com/View/Logout.aspx?x=1");
    expect(
      findLogoutLink(`<a href="javascript:void(0)">Log Out</a>`, "https://x.test/"),
    ).toBeNull();
    expect(findLogoutLink(`<a href="Help.aspx">Help</a>`, "https://x.test/")).toBeNull();
  });
});
