import FadeIn from "react-fade-in";
import AutoSearchForm from "../AutoSearchForm/AutoSearchForm";
import Banner from "../Banner";

const Home = () => {
  return (
    <FadeIn delay={100}>
      <div className="px-4 sm:px-6 lg:px-8 py-8 w-full max-w-4xl mx-auto">
        <Banner
          title="Welcome"
          subtitle="Start by selecting a year, make and model below to find parts"
        />
        <div className="bg-white rounded-lg shadow p-6">
          <AutoSearchForm />
        </div>
      </div>
    </FadeIn>
  );
};

export default Home;
