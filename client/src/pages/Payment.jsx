import React, {useEffect, useState} from "react";
import {PayPalButton} from "react-paypal-button-v2"
import Banner from "../components/Banner";





const Payment = () => {
    const [sdkReady, setSdkReady] = useState(false)
    useEffect(() => {
        const addPayPalScript = async () => {
      
          const script = document.createElement('script');
          script.type = 'text/javascript';
          script.src = `https://www.paypal.com/sdk/js?client-id=AYwzysoBeeaAzjC__TZqC-wzTk7O-bLSsf18lW-ZKrErtLEt2xI9aC18MKgGAlITpkX3PTmnTZFXyzeP`;
          script.async = true;
          script.onload = () => {
            setSdkReady(true);
          };
         
          document.body.appendChild(script);
        };
     
        
              addPayPalScript();
           
        
      }, []);
    return (
        <div class="mt-4 items-center w-11/12 mx-auto">
        <div class="">

        <Banner title="What We Offer" subtitle="    One time payment for full access."/>
          
            
<section className="md:flex items-center justify-around">
          
                <div class="md:w-1/2 w-11/12  px-4 py-4 bg-indigo-500 text-white shadow-lg rounded-lg">
                    <div class="px-6 py-8 sm:p-10 sm:pb-6">
                        <div class="flex justify-center">
                            <span class="inline-flex px-4 py-1 rounded-full text-sm leading-5 font-semibold tracking-wide uppercase">
                                Main Package
                            </span>
                        </div>
                        <div class="mt-4 flex justify-center text-6xl leading-none font-extrabold">
                            $100
                            <span class="ml-1 pt-8 text-2xl leading-8 font-medium text-gray-100">
                                
                            </span>
                        </div>
                    </div>
                    <p class="text-md mt-4">
                        Plan include :
                    </p>
                    <ul class="text-sm w-full mt-6 mb-6">
                        <li class="mb-3 flex items-center ">
                            <svg class="h-6 w-6 mr-2" xmlns="http://www.w3.org/2000/svg" width="6" height="6" stroke="currentColor" fill="currentColor" viewBox="0 0 1792 1792">
                                <path d="M1412 734q0-28-18-46l-91-90q-19-19-45-19t-45 19l-408 407-226-226q-19-19-45-19t-45 19l-91 90q-18 18-18 46 0 27 18 45l362 362q19 19 45 19 27 0 46-19l543-543q18-18 18-45zm252 162q0 209-103 385.5t-279.5 279.5-385.5 103-385.5-103-279.5-279.5-103-385.5 103-385.5 279.5-279.5 385.5-103 385.5 103 279.5 279.5 103 385.5z">
                                </path>
                            </svg>
                            Unlimited search
                        </li>
                        <li class="mb-3 flex items-center ">
                            <svg class="h-6 w-6 mr-2" xmlns="http://www.w3.org/2000/svg" width="6" height="6" stroke="currentColor" fill="currentColor" viewBox="0 0 1792 1792">
                                <path d="M1412 734q0-28-18-46l-91-90q-19-19-45-19t-45 19l-408 407-226-226q-19-19-45-19t-45 19l-91 90q-18 18-18 46 0 27 18 45l362 362q19 19 45 19 27 0 46-19l543-543q18-18 18-45zm252 162q0 209-103 385.5t-279.5 279.5-385.5 103-385.5-103-279.5-279.5-103-385.5 103-385.5 279.5-279.5 385.5-103 385.5 103 279.5 279.5 103 385.5z">
                                </path>
                            </svg>
                            Custom auto compatibility feature
                        </li>
                        <li class="mb-3 flex items-center ">
                            <svg class="h-6 w-6 mr-2" xmlns="http://www.w3.org/2000/svg" width="6" height="6" stroke="currentColor" fill="currentColor" viewBox="0 0 1792 1792">
                                <path d="M1412 734q0-28-18-46l-91-90q-19-19-45-19t-45 19l-408 407-226-226q-19-19-45-19t-45 19l-91 90q-18 18-18 46 0 27 18 45l362 362q19 19 45 19 27 0 46-19l543-543q18-18 18-45zm252 162q0 209-103 385.5t-279.5 279.5-385.5 103-385.5-103-279.5-279.5-103-385.5 103-385.5 279.5-279.5 385.5-103 385.5 103 279.5 279.5 103 385.5z">
                                </path>
                            </svg>
                            Exclusive trims & engines
                        </li>
                        <li class="mb-3 flex items-center ">
                            <svg class="h-6 w-6 mr-2" xmlns="http://www.w3.org/2000/svg" width="6" height="6" stroke="currentColor" fill="currentColor" viewBox="0 0 1792 1792">
                                <path d="M1412 734q0-28-18-46l-91-90q-19-19-45-19t-45 19l-408 407-226-226q-19-19-45-19t-45 19l-91 90q-18 18-18 46 0 27 18 45l362 362q19 19 45 19 27 0 46-19l543-543q18-18 18-45zm252 162q0 209-103 385.5t-279.5 279.5-385.5 103-385.5-103-279.5-279.5-103-385.5 103-385.5 279.5-279.5 385.5-103 385.5 103 279.5 279.5 103 385.5z">
                                </path>
                            </svg>
                           Continuously updated information
                        </li>
                      
                       
                    </ul>
                 
                </div>


<div className="w-1/2 px-4 py-4">
    {sdkReady && <PayPalButton
                        amount={150}
                       
                      ></PayPalButton>}


</div>
</section>
</div>
          </div>
    )
}

export default Payment